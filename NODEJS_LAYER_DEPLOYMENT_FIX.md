# Node.js Layer Deployment - Исправления

## Проблема 1: Отсутствие ZIP файлов при `cdk deploy`

**Ошибка**: 
```
Failed to attach Node.js runtime layer: No layer ZIP found for x86_64
```

**Причина**: Новый код требовал готовые ZIP файлы, которых у пользователя нет.

**Решение**: Реализована двухуровневая стратегия с fallback:

### Стратегия 1: Pre-built ZIP (приоритет)
- Ищет готовые ZIP файлы: `nodejs-layer-{arch}.zip`
- Если найдены → быстрый deploy через S3
- Избегает проблемы с 80MB бинарниками

### Стратегия 2: Docker Extraction (fallback)
- Если ZIP не найдены → автоматически использует Docker
- Извлекает Node.js из AWS Lambda образов
- Работает "из коробки" без дополнительных файлов

**Код**: `src/kata-wrapper.ts` - функция `applyTransformationWithNodeSupport`

---

## Проблема 2: EPIPE ошибка при создании больших ZIP файлов

**Ошибка**:
```
Error: write EPIPE
errno: -32
code: 'EPIPE'
syscall: 'write'
```

**Причина**: Python скрипт загружал весь файл (250MB) в память через `f.read()`, что вызывало падение процесса.

**Решение**: Использование streaming вместо загрузки в память

### Изменения в Python скрипте:

**БЫЛО** (загрузка в память):
```python
with open(file_path, 'rb') as f:
    file_data = f.read()  # ❌ Загружает весь файл в память
    total_original_size += len(file_data)
zipf.writestr(file_info, file_data)
```

**СТАЛО** (streaming):
```python
# Используем write() вместо writestr() для streaming
zipf.write(file_path, arc_name, compress_type=zipfile.ZIP_DEFLATED)
# ✅ Файл обрабатывается потоком, не загружается в память
```

### Дополнительные улучшения:

1. **Прогресс для больших файлов**:
```python
if stat_info.st_size > 10 * 1024 * 1024:  # >10MB
    print(f"Compressed: {arc_name} ({stat_info.st_size / (1024*1024):.1f}MB)")
```

2. **Улучшенный fallback** с системной командой `zip`:
```bash
zip -r -9 -q output.zip .
# -9: максимальная компрессия
# -q: тихий режим
```

**Код**: `src/aws-layer-manager.ts` - функция `createLayerZipArchive`

---

## Результат

### До исправлений:
- ❌ `cdk deploy` падал без ZIP файлов
- ❌ EPIPE ошибка при больших файлах (>80MB)
- ❌ Требовались готовые ZIP файлы

### После исправлений:
- ✅ `cdk deploy` работает без ZIP файлов (использует Docker)
- ✅ Поддержка больших файлов через streaming (до 250MB)
- ✅ Автоматический fallback между стратегиями
- ✅ Обратная совместимость с существующим кодом

---

## Тестирование

### Сценарий 1: С готовыми ZIP файлами
```bash
# Положить nodejs-layer-x86_64.zip в директорию проекта
cdk deploy
# ✅ Использует ZIP, быстрый deploy
```

### Сценарий 2: Без ZIP файлов
```bash
# Убедиться что Docker запущен
cdk deploy
# ✅ Автоматически использует Docker extraction
```

### Сценарий 3: Большие файлы (>80MB)
```bash
# Создать layer с большим Node.js бинарником
cdk deploy
# ✅ Streaming обработка, нет EPIPE ошибки
```

---

## Архитектурные решения

### Инварианты:
1. Kata трансформация **всегда** выполняется (даже если Node.js layer не прикреплен)
2. Ошибки Node.js layer → CDK warning (не блокируют deploy)
3. Cleanup ресурсов **всегда** происходит (finally блоки)
4. Идемпотентность: повторные вызовы используют существующие layers

### Complexity:
- **Streaming ZIP**: O(n) по размеру файлов, O(1) по памяти
- **Fallback стратегия**: O(1) дополнительная попытка при ошибке
- **Docker extraction**: O(n) по размеру образа, но кешируется Docker

### Security:
- Нет инъекций в Python скрипт (пути экранированы)
- Временные S3 bucket'ы всегда удаляются
- Layer manager ресурсы всегда освобождаются

---

## Файлы изменены:
- `src/kata-wrapper.ts` - двухуровневая стратегия deployment
- `src/aws-layer-manager.ts` - streaming ZIP creation
