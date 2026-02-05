/*
 * MIT License
 * 
 * Copyright (c) 2024 Lambda Kata Team
 * 
 * Structured logging with security considerations
 * 
 * @remarks Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5
 */

#include <stdio.h>
#include <stdlib.h>
#include <stdarg.h>
#include <string.h>
#include <time.h>
#include <ctype.h>
#include "include/validator.h"

// Global log level
static LogLevel current_log_level = LOG_LEVEL_INFO;

// Log level names
static const char* log_level_names[] = {
    "DEBUG",
    "INFO",
    "WARN",
    "ERROR"
};

// Only provide custom implementations for systems that lack them
#if !defined(__APPLE__) && !defined(_GNU_SOURCE)
/**
 * @brief Case-insensitive string search
 * 
 * Portable implementation of strcasestr for systems that don't have it.
 * 
 * @param haystack String to search in
 * @param needle String to search for
 * @return Pointer to first occurrence or NULL if not found
 */
static const char* strcasestr_impl(const char* haystack, const char* needle) {
    if (!haystack || !needle) {
        return NULL;
    }
    
    size_t needle_len = strlen(needle);
    if (needle_len == 0) {
        return haystack;
    }
    
    for (const char* p = haystack; *p; p++) {
        if (strncasecmp(p, needle, needle_len) == 0) {
            return p;
        }
    }
    
    return NULL;
}

/**
 * @brief Case-insensitive string comparison
 * 
 * Portable implementation of strncasecmp for systems that don't have it.
 * 
 * @param s1 First string
 * @param s2 Second string  
 * @param n Maximum number of characters to compare
 * @return 0 if equal, <0 if s1 < s2, >0 if s1 > s2
 */
static int strncasecmp_impl(const char* s1, const char* s2, size_t n) {
    if (!s1 || !s2) {
        return s1 ? 1 : (s2 ? -1 : 0);
    }
    
    for (size_t i = 0; i < n; i++) {
        int c1 = tolower((unsigned char)s1[i]);
        int c2 = tolower((unsigned char)s2[i]);
        
        if (c1 != c2) {
            return c1 - c2;
        }
        
        if (c1 == 0) {
            break;
        }
    }
    
    return 0;
}

#define strcasestr strcasestr_impl
#define strncasecmp strncasecmp_impl
#endif

/**
 * @brief Check if running in production mode
 * 
 * Determines the runtime environment to adjust logging behavior.
 * Production mode uses sanitized error messages.
 * 
 * @return true if production mode, false otherwise
 */
bool is_production_mode(void) {
    const char* node_env = getenv("NODE_ENV");
    return node_env && strcmp(node_env, "production") == 0;
}

/**
 * @brief Set global log level
 * 
 * Controls which log messages are output.
 * Higher levels include all lower levels.
 * 
 * @param level Minimum log level to output
 */
void set_log_level(LogLevel level) {
    current_log_level = level;
}

/**
 * @brief Get current timestamp string
 * 
 * Creates an ISO 8601 timestamp for log entries.
 * 
 * @param buffer Buffer to store timestamp (must be at least 32 bytes)
 * @param buffer_size Size of the buffer
 * @return true on success, false on failure
 */
static bool get_timestamp(char* buffer, size_t buffer_size) {
    time_t now = time(NULL);
    struct tm* utc_tm = gmtime(&now);
    
    if (!utc_tm) {
        return false;
    }
    
    int result = strftime(buffer, buffer_size, "%Y-%m-%dT%H:%M:%SZ", utc_tm);
    return result > 0;
}

/**
 * @brief Check if message contains sensitive data patterns
 * 
 * Scans message for patterns that might contain sensitive information
 * like account IDs, tokens, or detailed system information.
 * 
 * @param message Message to check
 * @return true if message contains sensitive patterns
 */
static bool contains_sensitive_data(const char* message) {
    if (!message) {
        return false;
    }
    
    // Check for account ID patterns (12 consecutive digits)
    const char* pos = message;
    while (*pos) {
        if (isdigit(*pos)) {
            int digit_count = 0;
            while (*pos && isdigit(*pos)) {
                digit_count++;
                pos++;
            }
            if (digit_count == 12) {
                return true; // Found 12-digit sequence (likely account ID)
            }
        } else {
            pos++;
        }
    }
    
    // Check for other sensitive patterns
    const char* sensitive_patterns[] = {
        "token",
        "key",
        "secret",
        "password",
        "auth",
        "bearer",
        "signature",
        "certificate",
        NULL
    };
    
    for (int i = 0; sensitive_patterns[i]; i++) {
        if (strcasestr(message, sensitive_patterns[i])) {
            return true;
        }
    }
    
    return false;
}

/**
 * @brief Sanitize log message for production
 * 
 * Removes sensitive information from log messages in production mode.
 * This prevents information leakage through logs.
 * 
 * @param message Original message
 * @param level Log level
 * @return Sanitized message (caller must free)
 */
static char* sanitize_message(const char* message, LogLevel level) {
    if (!is_production_mode()) {
        // In development, still check for sensitive data and warn
        if (contains_sensitive_data(message)) {
            log_message(LOG_LEVEL_WARN, "Development log contains potentially sensitive data");
        }
        return strdup(message); // No sanitization in development
    }
    
    // In production, use generic messages for security-sensitive logs
    switch (level) {
        case LOG_LEVEL_ERROR:
            if (contains_sensitive_data(message)) {
                return strdup("System error occurred");
            }
            // For non-sensitive error messages, use generic but informative text
            return strdup("System error occurred");
            
        case LOG_LEVEL_WARN:
            if (contains_sensitive_data(message)) {
                return strdup("Security or network error occurred");
            }
            // For non-sensitive warnings, still sanitize to prevent info leakage
            return strdup("Security or network error occurred");
            
        case LOG_LEVEL_INFO:
            if (contains_sensitive_data(message)) {
                return strdup("Operation completed");
            }
            return strdup(message); // Info messages are generally safe
            
        case LOG_LEVEL_DEBUG:
            return strdup("Debug information"); // Debug shouldn't appear in production
            
        default:
            return strdup("Unknown error occurred");
    }
}

/**
 * @brief Log a message with specified level
 * 
 * Outputs a structured log message if the level meets the threshold.
 * Messages are sanitized in production mode to prevent information leakage.
 * 
 * @param level Log level
 * @param format Printf-style format string
 * @param ... Format arguments
 * 
 * @remarks Validates: Requirements 9.1, 9.2, 9.3, 9.5
 */
void log_message(LogLevel level, const char* format, ...) {
    // Check if this level should be logged
    if (level < current_log_level) {
        return;
    }
    
    // Format the message
    va_list args;
    va_start(args, format);
    
    char message[512];
    int result = vsnprintf(message, sizeof(message), format, args);
    va_end(args);
    
    if (result < 0) {
        fprintf(stderr, "[ERROR] Failed to format log message\n");
        return;
    }
    
    // Truncate if too long
    if (result >= (int)sizeof(message)) {
        message[sizeof(message) - 4] = '.';
        message[sizeof(message) - 3] = '.';
        message[sizeof(message) - 2] = '.';
        message[sizeof(message) - 1] = '\0';
    }
    
    // Sanitize message for production
    char* sanitized = sanitize_message(message, level);
    if (!sanitized) {
        fprintf(stderr, "[ERROR] Failed to sanitize log message\n");
        return;
    }
    
    // Get timestamp
    char timestamp[32];
    if (!get_timestamp(timestamp, sizeof(timestamp))) {
        strcpy(timestamp, "UNKNOWN");
    }
    
    // Output structured log entry
    const char* level_name = (level < 4) ? log_level_names[level] : "UNKNOWN";
    
    // Use stderr for errors and warnings, stdout for info and debug
    FILE* output = (level >= LOG_LEVEL_WARN) ? stderr : stdout;
    
    fprintf(output, "[%s] %s native-validator: %s\n", 
            timestamp, level_name, sanitized);
    
    // Ensure immediate output for errors
    if (level >= LOG_LEVEL_ERROR) {
        fflush(output);
    }
    
    free(sanitized);
}

/**
 * @brief Log network error with categorization
 * 
 * Logs network errors with appropriate categorization and detail level
 * based on the environment mode.
 * 
 * @param curl_code libcurl error code
 * @param context Additional context string
 * 
 * @remarks Validates: Requirements 9.1, 9.2, 9.3
 */
void log_network_error(CURLcode curl_code, const char* context) {
    const char* error_category = "network";
    const char* error_description = curl_easy_strerror(curl_code);
    
    // Categorize the error for better debugging
    switch (curl_code) {
        case CURLE_OPERATION_TIMEDOUT:
            error_category = "timeout";
            break;
        case CURLE_SSL_CONNECT_ERROR:
        case CURLE_PEER_FAILED_VERIFICATION:
            error_category = "tls";
            break;
        case CURLE_COULDNT_RESOLVE_HOST:
        case CURLE_COULDNT_CONNECT:
            error_category = "connection";
            break;
        case CURLE_OUT_OF_MEMORY:
            error_category = "memory";
            break;
        default:
            error_category = "network";
            break;
    }
    
    if (is_production_mode()) {
        // Generic error message in production
        log_message(LOG_LEVEL_WARN, "Network validation failed: %s error", error_category);
    } else {
        // Detailed error message in development
        log_message(LOG_LEVEL_WARN, "Network validation failed: %s error (%s) - %s", 
                   error_category, error_description, context ? context : "no context");
    }
}

/**
 * @brief Log memory allocation failure
 * 
 * Logs memory allocation failures with appropriate detail level.
 * These are critical errors that should always be logged.
 * 
 * @param context Context where allocation failed
 * @param size Size of failed allocation (0 if unknown)
 * 
 * @remarks Validates: Requirements 9.1, 9.2
 */
void log_memory_error(const char* context, size_t size) {
    if (is_production_mode()) {
        log_message(LOG_LEVEL_ERROR, "Memory allocation failed");
    } else {
        if (size > 0) {
            log_message(LOG_LEVEL_ERROR, "Memory allocation failed: %zu bytes for %s", 
                       size, context ? context : "unknown");
        } else {
            log_message(LOG_LEVEL_ERROR, "Memory allocation failed for %s", 
                       context ? context : "unknown");
        }
    }
}

/**
 * @brief Log JSON parsing error
 * 
 * Logs JSON parsing errors without exposing response content.
 * 
 * @param error_type Type of JSON error
 * @param context Additional context
 * 
 * @remarks Validates: Requirements 9.1, 9.3
 */
void log_json_error(const char* error_type, const char* context) {
    if (is_production_mode()) {
        log_message(LOG_LEVEL_WARN, "Response parsing failed");
    } else {
        log_message(LOG_LEVEL_WARN, "JSON parsing failed: %s - %s", 
                   error_type ? error_type : "unknown error",
                   context ? context : "no context");
    }
}

/**
 * @brief Log security validation failure
 * 
 * Logs security-related validation failures with minimal information
 * to prevent information leakage while maintaining auditability.
 * 
 * @param validation_type Type of security validation that failed
 * @param context Additional context (will be sanitized)
 * 
 * @remarks Validates: Requirements 9.1, 9.3, 9.5
 */
void log_security_error(const char* validation_type, const char* context) {
    if (is_production_mode()) {
        log_message(LOG_LEVEL_WARN, "Security validation failed");
    } else {
        log_message(LOG_LEVEL_WARN, "Security validation failed: %s - %s",
                   validation_type ? validation_type : "unknown",
                   context ? context : "no context");
    }
}

/**
 * @brief Log validation success with minimal information
 * 
 * Logs successful validation without exposing sensitive details.
 * 
 * @param entitled Whether account is entitled
 * @param cached Whether result came from cache
 * 
 * @remarks Validates: Requirements 9.1, 9.5
 */
void log_validation_success(bool entitled, bool cached) {
    if (is_production_mode()) {
        log_message(LOG_LEVEL_INFO, "Validation completed");
    } else {
        log_message(LOG_LEVEL_DEBUG, "Validation completed: entitled=%s, cached=%s",
                   entitled ? "true" : "false",
                   cached ? "true" : "false");
    }
}