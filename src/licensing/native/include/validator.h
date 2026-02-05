/*
 * MIT License
 * 
 * Copyright (c) 2024 Lambda Kata Team
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 */

#ifndef VALIDATOR_H
#define VALIDATOR_H

#include <stdbool.h>
#include <stdint.h>
#include <time.h>
#include <curl/curl.h>

#ifdef __cplusplus
extern "C" {
#endif

// Security constants - hardcoded at compile time
#define LICENSING_HOST "licensing.lambdakata.com"
#define LICENSING_PORT 443
#define LICENSING_PATH "/v1/license/check"
#define LICENSING_PRODUCT_CODE "lambda-kata-runtime"

// Timeout constants (milliseconds)
#define CONNECTION_TIMEOUT_MS 10000
#define READ_TIMEOUT_MS 15000

// Cache configuration
#define CACHE_SIZE 16
#define CACHE_TTL_SECONDS 300  // 5 minutes

// Account ID validation
#define ACCOUNT_ID_LENGTH 12
#define MAX_ACCOUNT_ID_STRING_LENGTH 13  // 12 digits + null terminator

// Response size limits
#define MAX_RESPONSE_SIZE 4096
#define MAX_MESSAGE_LENGTH 256
#define MAX_ARN_LENGTH 512

/**
 * @brief Validation result structure
 * 
 * Contains the result of a licensing validation check.
 * All string fields are dynamically allocated and must be freed.
 */
typedef struct {
    bool entitled;                    // Entitlement status
    char* layer_arn;                 // Customer Layer ARN (nullable)
    char* message;                   // Status message (nullable)
    char* expires_at;                // ISO 8601 expiration (nullable)
    int error_code;                  // Internal error code for debugging
} ValidationResult;

/**
 * @brief Cache entry structure
 * 
 * Represents a cached validation result with expiration.
 */
typedef struct {
    char account_id[MAX_ACCOUNT_ID_STRING_LENGTH];  // 12 digits + null terminator
    ValidationResult result;                        // Cached result
    time_t expires_at;                             // Cache expiration timestamp
    bool valid;                                    // Entry validity flag
} CacheEntry;

/**
 * @brief Network response structure
 * 
 * Contains raw HTTP response data and metadata.
 */
typedef struct {
    char* data;                      // Response body
    size_t size;                     // Response size
    long response_code;              // HTTP status code
    char* content_type;              // Content-Type header
} NetworkResponse;

// Core validation functions
ValidationResult* validate_entitlement(const char* account_id);
void free_validation_result(ValidationResult* result);

// Input validation
bool is_valid_account_id(const char* account_id);

// Network functions
NetworkResponse* make_licensing_request(const char* account_id);
void free_network_response(NetworkResponse* response);
ValidationResult* parse_json_response(const NetworkResponse* response);
void cleanup_network_resources(void);

// Security functions
bool verify_response_authenticity(const NetworkResponse* response);
bool verify_host_certificate(const char* hostname);
bool configure_spki_pinning(CURL* curl);

// Cache functions
ValidationResult* cache_get(const char* account_id);
void cache_put(const char* account_id, const ValidationResult* result);
void cache_init(void);
void cache_cleanup(void);

// Logging functions
typedef enum {
    LOG_LEVEL_DEBUG = 0,
    LOG_LEVEL_INFO = 1,
    LOG_LEVEL_WARN = 2,
    LOG_LEVEL_ERROR = 3
} LogLevel;

void log_message(LogLevel level, const char* format, ...);
void set_log_level(LogLevel level);
bool is_production_mode(void);

// Specialized logging functions for different error types
void log_network_error(CURLcode curl_code, const char* context);
void log_memory_error(const char* context, size_t size);
void log_json_error(const char* error_type, const char* context);
void log_security_error(const char* validation_type, const char* context);
void log_validation_success(bool entitled, bool cached);

// Error codes for debugging
typedef enum {
    ERROR_NONE = 0,
    ERROR_INVALID_ACCOUNT_ID = 1,
    ERROR_NETWORK_FAILURE = 2,
    ERROR_TLS_FAILURE = 3,
    ERROR_TIMEOUT = 4,
    ERROR_INVALID_RESPONSE = 5,
    ERROR_SECURITY_FAILURE = 6,
    ERROR_MEMORY_ALLOCATION = 7,
    ERROR_SYSTEM_ERROR = 8,
    ERROR_JSON_PARSE_FAILURE = 9,
    ERROR_JSON_MISSING_FIELD = 10,
    ERROR_JSON_WRONG_TYPE = 11
} ErrorCode;

#ifdef __cplusplus
}
#endif

#endif // VALIDATOR_H