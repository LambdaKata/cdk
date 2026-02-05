/*
 * MIT License
 * 
 * Copyright (c) 2024 Lambda Kata Team
 * 
 * Core validation logic with fail-closed architecture
 * 
 * @remarks Validates: Requirements 4.4, 4.5, 2.1, 2.6
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include "include/validator.h"

/**
 * @brief Validate account ID format
 * 
 * Checks that the account ID is exactly 12 digits.
 * This is the first line of defense for input validation.
 * 
 * @param account_id Account ID string to validate
 * @return true if valid format, false otherwise
 * 
 * @remarks Validates: Requirements 4.4, 4.5
 */
bool is_valid_account_id(const char* account_id) {
    if (!account_id) {
        log_message(LOG_LEVEL_DEBUG, "Account ID is NULL");
        return false;
    }
    
    size_t len = strlen(account_id);
    if (len != ACCOUNT_ID_LENGTH) {
        log_message(LOG_LEVEL_DEBUG, "Account ID length %zu, expected %d", len, ACCOUNT_ID_LENGTH);
        return false;
    }
    
    // Check that all characters are digits
    for (size_t i = 0; i < len; i++) {
        if (!isdigit(account_id[i])) {
            log_message(LOG_LEVEL_DEBUG, "Account ID contains non-digit character at position %zu", i);
            return false;
        }
    }
    
    return true;
}

/**
 * @brief Main validation function
 * 
 * Coordinates the entire validation process with fail-closed behavior.
 * This function ensures that any error condition results in denial.
 * 
 * @param account_id 12-digit AWS account ID string
 * @return ValidationResult pointer (caller must free)
 * 
 * @remarks Validates: Requirements 2.1, 2.6
 */
ValidationResult* validate_entitlement(const char* account_id) {
    ValidationResult* result = NULL;
    NetworkResponse* response = NULL;
    
    log_message(LOG_LEVEL_DEBUG, "Starting validation for account ID");
    
    // Allocate result structure
    result = (ValidationResult*)calloc(1, sizeof(ValidationResult));
    if (!result) {
        log_memory_error("validation result allocation", sizeof(ValidationResult));
        return NULL; // Fail closed - NULL result indicates failure
    }
    
    // Initialize with fail-closed defaults
    result->entitled = false;
    result->layer_arn = NULL;
    result->message = NULL;
    result->expires_at = NULL;
    result->error_code = ERROR_NONE;
    
    // Validate account ID format (redundant check for defense in depth)
    if (!is_valid_account_id(account_id)) {
        result->error_code = ERROR_INVALID_ACCOUNT_ID;
        result->message = strdup("Invalid account ID format");
        log_message(LOG_LEVEL_WARN, "Validation failed: invalid account ID format");
        return result; // Fail closed
    }
    
    // Check cache first
    ValidationResult* cached = cache_get(account_id);
    if (cached) {
        log_validation_success(cached->entitled, true);
        // Return copy of cached result
        result->entitled = cached->entitled;
        if (cached->layer_arn) {
            result->layer_arn = strdup(cached->layer_arn);
        }
        if (cached->message) {
            result->message = strdup(cached->message);
        }
        if (cached->expires_at) {
            result->expires_at = strdup(cached->expires_at);
        }
        result->error_code = cached->error_code;
        return result;
    }
    
    // Make network request
    response = make_licensing_request(account_id);
    if (!response) {
        result->error_code = ERROR_NETWORK_FAILURE;
        result->message = strdup("Network error");
        log_network_error(CURLE_FAILED_INIT, "network request returned null");
        return result; // Fail closed
    }
    
    // Verify response authenticity
    if (!verify_response_authenticity(response)) {
        result->error_code = ERROR_SECURITY_FAILURE;
        result->message = strdup("Security error");
        log_security_error("response authenticity", "verification failed");
        free_network_response(response);
        return result; // Fail closed
    }
    
    // Parse JSON response
    ValidationResult* parsed_result = parse_json_response(response);
    if (!parsed_result) {
        result->error_code = ERROR_MEMORY_ALLOCATION;
        result->message = strdup("Memory allocation error");
        log_memory_error("JSON parsing result allocation", 0);
        free_network_response(response);
        return result; // Fail closed
    }
    
    // Transfer parsed data to our result structure
    result->entitled = parsed_result->entitled;
    result->error_code = parsed_result->error_code;
    
    // Transfer allocated strings (take ownership)
    if (parsed_result->layer_arn) {
        result->layer_arn = parsed_result->layer_arn;
        parsed_result->layer_arn = NULL; // Transfer ownership
    }
    
    if (parsed_result->message) {
        free(result->message); // Free the default message
        result->message = parsed_result->message;
        parsed_result->message = NULL; // Transfer ownership
    }
    
    if (parsed_result->expires_at) {
        result->expires_at = parsed_result->expires_at;
        parsed_result->expires_at = NULL; // Transfer ownership
    }
    
    // If parsing had errors but we got a result, preserve the error code
    if (parsed_result->error_code != ERROR_NONE) {
        result->error_code = parsed_result->error_code;
    }
    
    log_message(LOG_LEVEL_DEBUG, "JSON response parsed, entitled=%s, error_code=%d", 
                result->entitled ? "true" : "false", result->error_code);
    
    // Cache successful results only (entitled=true and no errors)
    if (result->entitled && result->error_code == ERROR_NONE) {
        cache_put(account_id, result);
        log_validation_success(result->entitled, false);
    } else {
        log_validation_success(result->entitled, false);
    }
    
    // Cleanup
    free_validation_result(parsed_result);
    free_network_response(response);
    
    return result;
}

/**
 * @brief Free validation result structure
 * 
 * Safely deallocates all memory associated with a ValidationResult.
 * 
 * @param result ValidationResult to free (can be NULL)
 */
void free_validation_result(ValidationResult* result) {
    if (!result) {
        return;
    }
    
    free(result->layer_arn);
    free(result->message);
    free(result->expires_at);
    free(result);
}