/*
 * MIT License
 * 
 * Copyright (c) 2024 Lambda Kata Team
 * 
 * Memory optimization utilities for native licensing validator
 * 
 * @remarks Validates: Requirements 10.2, 10.4
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include "include/validator.h"

// Memory pool for small allocations
#define SMALL_POOL_SIZE 64
#define SMALL_BLOCK_SIZE 256
#define STRING_POOL_SIZE 32
#define STRING_POOL_BLOCK_SIZE 128

// Memory pools
static char small_pool[SMALL_POOL_SIZE][SMALL_BLOCK_SIZE];
static bool small_pool_used[SMALL_POOL_SIZE];
static char string_pool[STRING_POOL_SIZE][STRING_POOL_BLOCK_SIZE];
static bool string_pool_used[STRING_POOL_SIZE];
static bool pools_initialized = false;

// Memory usage tracking
static size_t total_allocated = 0;
static size_t peak_allocated = 0;
static size_t allocation_count = 0;

// String interning table for common messages
typedef struct {
    const char* string;
    size_t length;
} InternedString;

static const InternedString interned_strings[] = {
    {"Invalid account ID format", 25},
    {"Network error", 13},
    {"Security error", 14},
    {"System error", 12},
    {"Memory allocation error", 23},
    {"Native validator unavailable", 28},
    {NULL, 0} // Sentinel
};

/**
 * @brief Initialize memory pools
 * 
 * Sets up memory pools for efficient allocation of small objects.
 * This reduces malloc/free overhead and memory fragmentation.
 */
void init_memory_pools(void) {
    if (pools_initialized) {
        return;
    }
    
    // Initialize pool usage tracking
    memset(small_pool_used, false, sizeof(small_pool_used));
    memset(string_pool_used, false, sizeof(string_pool_used));
    
    pools_initialized = true;
    log_message(LOG_LEVEL_DEBUG, "Memory pools initialized: %d small blocks, %d string blocks", 
                SMALL_POOL_SIZE, STRING_POOL_SIZE);
}

/**
 * @brief Allocate from small object pool
 * 
 * Attempts to allocate from the small object pool first,
 * falling back to malloc if pool is exhausted.
 * 
 * @param size Size to allocate (must be <= SMALL_BLOCK_SIZE)
 * @return Pointer to allocated memory or NULL on failure
 */
void* pool_alloc_small(size_t size) {
    if (!pools_initialized) {
        init_memory_pools();
    }
    
    if (size > SMALL_BLOCK_SIZE) {
        // Too large for pool, use regular malloc
        void* ptr = malloc(size);
        if (ptr) {
            total_allocated += size;
            allocation_count++;
            if (total_allocated > peak_allocated) {
                peak_allocated = total_allocated;
            }
        }
        return ptr;
    }
    
    // Try to find free block in pool
    for (int i = 0; i < SMALL_POOL_SIZE; i++) {
        if (!small_pool_used[i]) {
            small_pool_used[i] = true;
            total_allocated += SMALL_BLOCK_SIZE;
            allocation_count++;
            if (total_allocated > peak_allocated) {
                peak_allocated = total_allocated;
            }
            log_message(LOG_LEVEL_DEBUG, "Allocated from small pool, block %d", i);
            return small_pool[i];
        }
    }
    
    // Pool exhausted, fall back to malloc
    void* ptr = malloc(size);
    if (ptr) {
        total_allocated += size;
        allocation_count++;
        if (total_allocated > peak_allocated) {
            peak_allocated = total_allocated;
        }
        log_message(LOG_LEVEL_DEBUG, "Small pool exhausted, using malloc for %zu bytes", size);
    }
    return ptr;
}

/**
 * @brief Free memory allocated from small pool
 * 
 * Returns memory to the pool if it was pool-allocated,
 * otherwise calls free().
 * 
 * @param ptr Pointer to free
 * @param size Original allocation size
 */
void pool_free_small(void* ptr, size_t size) {
    if (!ptr) {
        return;
    }
    
    // Check if pointer is within pool range
    char* char_ptr = (char*)ptr;
    if (char_ptr >= (char*)small_pool && char_ptr < (char*)small_pool + sizeof(small_pool)) {
        // Calculate pool index
        int index = (char_ptr - (char*)small_pool) / SMALL_BLOCK_SIZE;
        if (index >= 0 && index < SMALL_POOL_SIZE && small_pool_used[index]) {
            small_pool_used[index] = false;
            total_allocated -= SMALL_BLOCK_SIZE;
            log_message(LOG_LEVEL_DEBUG, "Returned to small pool, block %d", index);
            return;
        }
    }
    
    // Not from pool, use regular free
    free(ptr);
    total_allocated -= size;
}

/**
 * @brief Allocate string from string pool
 * 
 * Optimized allocation for strings, with interning for common strings.
 * 
 * @param str String to allocate/intern
 * @return Pointer to string (may be interned constant)
 */
char* pool_alloc_string(const char* str) {
    if (!str) {
        return NULL;
    }
    
    if (!pools_initialized) {
        init_memory_pools();
    }
    
    size_t len = strlen(str);
    
    // Check if string is in interned table
    for (const InternedString* interned = interned_strings; interned->string; interned++) {
        if (len == interned->length && strcmp(str, interned->string) == 0) {
            log_message(LOG_LEVEL_DEBUG, "Using interned string");
            return (char*)interned->string; // Return const string (safe for read-only use)
        }
    }
    
    // Try string pool if string fits
    if (len + 1 <= STRING_POOL_BLOCK_SIZE) {
        for (int i = 0; i < STRING_POOL_SIZE; i++) {
            if (!string_pool_used[i]) {
                string_pool_used[i] = true;
                strcpy(string_pool[i], str);
                total_allocated += STRING_POOL_BLOCK_SIZE;
                allocation_count++;
                if (total_allocated > peak_allocated) {
                    peak_allocated = total_allocated;
                }
                log_message(LOG_LEVEL_DEBUG, "Allocated from string pool, block %d", i);
                return string_pool[i];
            }
        }
    }
    
    // Fall back to regular strdup
    char* result = strdup(str);
    if (result) {
        total_allocated += len + 1;
        allocation_count++;
        if (total_allocated > peak_allocated) {
            peak_allocated = total_allocated;
        }
        log_message(LOG_LEVEL_DEBUG, "String pool exhausted, using strdup for %zu bytes", len + 1);
    }
    return result;
}

/**
 * @brief Free string allocated from string pool
 * 
 * Returns string to pool if pool-allocated, otherwise calls free().
 * Does nothing for interned strings.
 * 
 * @param str String to free
 */
void pool_free_string(char* str) {
    if (!str) {
        return;
    }
    
    // Check if it's an interned string (don't free)
    for (const InternedString* interned = interned_strings; interned->string; interned++) {
        if (str == interned->string) {
            log_message(LOG_LEVEL_DEBUG, "Not freeing interned string");
            return;
        }
    }
    
    // Check if pointer is within string pool range
    if (str >= (char*)string_pool && str < (char*)string_pool + sizeof(string_pool)) {
        // Calculate pool index
        int index = (str - (char*)string_pool) / STRING_POOL_BLOCK_SIZE;
        if (index >= 0 && index < STRING_POOL_SIZE && string_pool_used[index]) {
            string_pool_used[index] = false;
            total_allocated -= STRING_POOL_BLOCK_SIZE;
            log_message(LOG_LEVEL_DEBUG, "Returned to string pool, block %d", index);
            return;
        }
    }
    
    // Not from pool, use regular free
    free(str);
    // Note: We can't accurately track the size here, so we don't update total_allocated
}

/**
 * @brief Get memory usage statistics
 * 
 * Returns current memory usage information for monitoring.
 * 
 * @param total_bytes Output parameter for total allocated bytes
 * @param peak_bytes Output parameter for peak allocated bytes
 * @param allocation_count_out Output parameter for allocation count
 */
void get_memory_stats(size_t* total_bytes, size_t* peak_bytes, size_t* allocation_count_out) {
    if (total_bytes) {
        *total_bytes = total_allocated;
    }
    if (peak_bytes) {
        *peak_bytes = peak_allocated;
    }
    if (allocation_count_out) {
        *allocation_count_out = allocation_count;
    }
}

/**
 * @brief Check if memory usage is within bounds
 * 
 * Verifies that current memory usage is under the 1MB requirement.
 * 
 * @return true if within bounds, false if exceeding limits
 */
bool is_memory_usage_within_bounds(void) {
    const size_t MAX_MEMORY_BYTES = 1024 * 1024; // 1MB
    
    if (total_allocated > MAX_MEMORY_BYTES) {
        log_message(LOG_LEVEL_WARN, "Memory usage %zu bytes exceeds 1MB limit", total_allocated);
        return false;
    }
    
    return true;
}

/**
 * @brief Optimize memory layout
 * 
 * Performs memory layout optimizations to reduce fragmentation
 * and improve cache locality.
 */
void optimize_memory_layout(void) {
    // Compact string pool by moving used blocks to the beginning
    int write_index = 0;
    for (int read_index = 0; read_index < STRING_POOL_SIZE; read_index++) {
        if (string_pool_used[read_index]) {
            if (write_index != read_index) {
                // Move block
                memcpy(string_pool[write_index], string_pool[read_index], STRING_POOL_BLOCK_SIZE);
                string_pool_used[write_index] = true;
                string_pool_used[read_index] = false;
            }
            write_index++;
        }
    }
    
    log_message(LOG_LEVEL_DEBUG, "Memory layout optimized, %d string blocks compacted", write_index);
}

/**
 * @brief Cleanup memory pools
 * 
 * Cleans up memory pools during shutdown.
 * Pool memory is static, so no actual deallocation needed.
 */
void cleanup_memory_pools(void) {
    if (!pools_initialized) {
        return;
    }
    
    // Mark all blocks as unused
    memset(small_pool_used, false, sizeof(small_pool_used));
    memset(string_pool_used, false, sizeof(string_pool_used));
    
    // Log final statistics
    log_message(LOG_LEVEL_INFO, "Memory pools cleanup - Peak usage: %zu bytes, Allocations: %zu", 
                peak_allocated, allocation_count);
    
    pools_initialized = false;
    total_allocated = 0;
    peak_allocated = 0;
    allocation_count = 0;
}

/**
 * @brief Optimized ValidationResult allocation
 * 
 * Allocates ValidationResult using memory pool for better performance.
 * 
 * @return Pointer to allocated ValidationResult or NULL on failure
 */
ValidationResult* alloc_validation_result(void) {
    ValidationResult* result = (ValidationResult*)pool_alloc_small(sizeof(ValidationResult));
    if (result) {
        // Initialize with fail-closed defaults
        result->entitled = false;
        result->layer_arn = NULL;
        result->message = NULL;
        result->expires_at = NULL;
        result->error_code = ERROR_NONE;
    }
    return result;
}

/**
 * @brief Optimized ValidationResult deallocation
 * 
 * Frees ValidationResult using memory pool.
 * 
 * @param result ValidationResult to free
 */
void free_validation_result_optimized(ValidationResult* result) {
    if (!result) {
        return;
    }
    
    // Free string fields using pool-aware free
    pool_free_string(result->layer_arn);
    pool_free_string(result->message);
    pool_free_string(result->expires_at);
    
    // Free the result structure itself
    pool_free_small(result, sizeof(ValidationResult));
}