/*
 * MIT License
 * 
 * Copyright (c) 2024 Lambda Kata Team
 * 
 * Node-API bridge for native licensing validator
 * 
 * @remarks Validates: Requirements 4.1, 4.2, 4.3
 */

#include <node_api.h>
#include <string.h>
#include <stdlib.h>
#include "include/validator.h"

// Forward declarations
static napi_value CheckEntitlement(napi_env env, napi_callback_info info);
static napi_value CheckEntitlementSync(napi_env env, napi_callback_info info);
static void ExecuteValidation(napi_env env, void* data);
static void CompleteValidation(napi_env env, napi_status status, void* data);

/**
 * @brief Async work data structure
 * 
 * Contains all data needed for async validation work.
 */
typedef struct {
    napi_async_work work;
    napi_deferred deferred;
    char account_id[MAX_ACCOUNT_ID_STRING_LENGTH];
    ValidationResult* result;
    napi_env env;
} AsyncWorkData;

/**
 * @brief Main entry point for checkEntitlement function
 * 
 * Extracts account ID from JavaScript and initiates async validation.
 * 
 * @param env Node-API environment
 * @param info Callback info containing arguments
 * @return Promise that resolves to LicensingResponse
 */
static napi_value CheckEntitlement(napi_env env, napi_callback_info info) {
    napi_status status;
    size_t argc = 1;
    napi_value args[1];
    napi_value promise;
    napi_deferred deferred;
    AsyncWorkData* work_data = NULL;
    
    // Get function arguments
    status = napi_get_cb_info(env, info, &argc, args, NULL, NULL);
    if (status != napi_ok || argc != 1) {
        log_message(LOG_LEVEL_WARN, "Invalid arguments to checkEntitlement function");
        napi_throw_error(env, "INVALID_ARGS", "Expected exactly one string argument");
        return NULL;
    }
    
    // Create promise
    status = napi_create_promise(env, &deferred, &promise);
    if (status != napi_ok) {
        log_message(LOG_LEVEL_ERROR, "Failed to create promise in Node-API bridge");
        napi_throw_error(env, "PROMISE_ERROR", "Failed to create promise");
        return NULL;
    }
    
    // Allocate work data
    work_data = (AsyncWorkData*)malloc(sizeof(AsyncWorkData));
    if (!work_data) {
        log_memory_error("async work data allocation", sizeof(AsyncWorkData));
        napi_value error;
        napi_create_string_utf8(env, "Memory allocation failed", NAPI_AUTO_LENGTH, &error);
        napi_reject_deferred(env, deferred, error);
        return promise;
    }
    
    work_data->deferred = deferred;
    work_data->result = NULL;
    work_data->env = env;
    
    // Extract account ID string
    napi_valuetype valuetype;
    status = napi_typeof(env, args[0], &valuetype);
    if (status != napi_ok || valuetype != napi_string) {
        log_message(LOG_LEVEL_WARN, "Account ID parameter is not a string");
        free(work_data);
        napi_value error;
        napi_create_string_utf8(env, "Account ID must be a string", NAPI_AUTO_LENGTH, &error);
        napi_reject_deferred(env, deferred, error);
        return promise;
    }
    
    size_t str_length;
    status = napi_get_value_string_utf8(env, args[0], work_data->account_id, 
                                       MAX_ACCOUNT_ID_STRING_LENGTH, &str_length);
    if (status != napi_ok) {
        log_message(LOG_LEVEL_ERROR, "Failed to extract account ID string from Node-API");
        free(work_data);
        napi_value error;
        napi_create_string_utf8(env, "Failed to extract account ID", NAPI_AUTO_LENGTH, &error);
        napi_reject_deferred(env, deferred, error);
        return promise;
    }
    
    // Ensure null termination
    work_data->account_id[MAX_ACCOUNT_ID_STRING_LENGTH - 1] = '\0';
    
    // Validate account ID format in JavaScript layer first (fail fast)
    if (!is_valid_account_id(work_data->account_id)) {
        log_message(LOG_LEVEL_WARN, "Invalid account ID format provided to Node-API bridge");
        free(work_data);
        napi_value error;
        napi_create_string_utf8(env, "Invalid account ID format", NAPI_AUTO_LENGTH, &error);
        napi_reject_deferred(env, deferred, error);
        return promise;
    }
    
    // Create async work
    napi_value resource_name;
    status = napi_create_string_utf8(env, "CheckEntitlement", NAPI_AUTO_LENGTH, &resource_name);
    if (status != napi_ok) {
        log_message(LOG_LEVEL_ERROR, "Failed to create resource name for async work");
        free(work_data);
        napi_value error;
        napi_create_string_utf8(env, "Failed to create async work", NAPI_AUTO_LENGTH, &error);
        napi_reject_deferred(env, deferred, error);
        return promise;
    }
    
    status = napi_create_async_work(env, NULL, resource_name,
                                   ExecuteValidation, CompleteValidation,
                                   work_data, &work_data->work);
    if (status != napi_ok) {
        log_message(LOG_LEVEL_ERROR, "Failed to create async work for validation");
        free(work_data);
        napi_value error;
        napi_create_string_utf8(env, "Failed to create async work", NAPI_AUTO_LENGTH, &error);
        napi_reject_deferred(env, deferred, error);
        return promise;
    }
    
    // Queue async work
    status = napi_queue_async_work(env, work_data->work);
    if (status != napi_ok) {
        log_message(LOG_LEVEL_ERROR, "Failed to queue async work for validation");
        napi_delete_async_work(env, work_data->work);
        free(work_data);
        napi_value error;
        napi_create_string_utf8(env, "Failed to queue async work", NAPI_AUTO_LENGTH, &error);
        napi_reject_deferred(env, deferred, error);
        return promise;
    }
    
    log_message(LOG_LEVEL_DEBUG, "Async validation work queued successfully");
    return promise;
}

/**
 * @brief Synchronous entry point for checkEntitlementSync function
 * 
 * Performs validation synchronously, blocking the Node.js event loop.
 * This is intended for use during CDK synthesis where async operations
 * cannot be awaited.
 * 
 * WARNING: This function blocks the event loop. Use only when async
 * operations are not possible (e.g., CDK synthesis).
 * 
 * @param env Node-API environment
 * @param info Callback info containing arguments
 * @return LicensingResponse object (synchronous)
 */
static napi_value CheckEntitlementSync(napi_env env, napi_callback_info info) {
    napi_status status;
    size_t argc = 1;
    napi_value args[1];
    napi_value result_obj;
    char account_id[MAX_ACCOUNT_ID_STRING_LENGTH];
    ValidationResult* result = NULL;
    
    // Get function arguments
    status = napi_get_cb_info(env, info, &argc, args, NULL, NULL);
    if (status != napi_ok || argc != 1) {
        log_message(LOG_LEVEL_WARN, "Invalid arguments to checkEntitlementSync function");
        napi_throw_error(env, "INVALID_ARGS", "Expected exactly one string argument");
        return NULL;
    }
    
    // Extract account ID string
    napi_valuetype valuetype;
    status = napi_typeof(env, args[0], &valuetype);
    if (status != napi_ok || valuetype != napi_string) {
        log_message(LOG_LEVEL_WARN, "Account ID parameter is not a string");
        goto fail_closed;
    }
    
    size_t str_length;
    status = napi_get_value_string_utf8(env, args[0], account_id, 
                                       MAX_ACCOUNT_ID_STRING_LENGTH, &str_length);
    if (status != napi_ok) {
        log_message(LOG_LEVEL_ERROR, "Failed to extract account ID string");
        goto fail_closed;
    }
    
    // Ensure null termination
    account_id[MAX_ACCOUNT_ID_STRING_LENGTH - 1] = '\0';
    
    // Validate account ID format (fail fast)
    if (!is_valid_account_id(account_id)) {
        log_message(LOG_LEVEL_WARN, "Invalid account ID format in sync validation");
        goto fail_closed;
    }
    
    // Perform validation SYNCHRONOUSLY (blocks event loop)
    log_message(LOG_LEVEL_DEBUG, "Starting synchronous validation");
    result = validate_entitlement(account_id);
    
    if (!result) {
        log_message(LOG_LEVEL_ERROR, "Synchronous validation returned null");
        goto fail_closed;
    }
    
    // Create result object
    status = napi_create_object(env, &result_obj);
    if (status != napi_ok) {
        log_message(LOG_LEVEL_ERROR, "Failed to create result object");
        free_validation_result(result);
        goto fail_closed;
    }
    
    // Set entitled property
    napi_value entitled_val;
    status = napi_get_boolean(env, result->entitled, &entitled_val);
    if (status == napi_ok) {
        napi_set_named_property(env, result_obj, "entitled", entitled_val);
    }
    
    // Set layer_arn property (nullable)
    if (result->layer_arn) {
        napi_value layer_arn_val;
        status = napi_create_string_utf8(env, result->layer_arn, NAPI_AUTO_LENGTH, &layer_arn_val);
        if (status == napi_ok) {
            napi_set_named_property(env, result_obj, "layerArn", layer_arn_val);
        }
    }
    
    // Set message property (nullable)
    if (result->message) {
        napi_value message_val;
        status = napi_create_string_utf8(env, result->message, NAPI_AUTO_LENGTH, &message_val);
        if (status == napi_ok) {
            napi_set_named_property(env, result_obj, "message", message_val);
        }
    }
    
    // Set expires_at property (nullable)
    if (result->expires_at) {
        napi_value expires_at_val;
        status = napi_create_string_utf8(env, result->expires_at, NAPI_AUTO_LENGTH, &expires_at_val);
        if (status == napi_ok) {
            napi_set_named_property(env, result_obj, "expiresAt", expires_at_val);
        }
    }
    
    free_validation_result(result);
    log_message(LOG_LEVEL_DEBUG, "Synchronous validation completed successfully");
    return result_obj;
    
fail_closed:
    // Return fail-closed response object
    if (result) {
        free_validation_result(result);
    }
    
    status = napi_create_object(env, &result_obj);
    if (status != napi_ok) {
        napi_throw_error(env, "ALLOC_ERROR", "Failed to create fail-closed response");
        return NULL;
    }
    
    napi_value false_val;
    napi_get_boolean(env, false, &false_val);
    napi_set_named_property(env, result_obj, "entitled", false_val);
    
    napi_value msg_val;
    napi_create_string_utf8(env, "Validation failed", NAPI_AUTO_LENGTH, &msg_val);
    napi_set_named_property(env, result_obj, "message", msg_val);
    
    return result_obj;
}

/**
 * @brief Execute validation in background thread
 * 
 * Calls native validator function without blocking Node.js event loop.
 * 
 * @param env Node-API environment (not used in worker thread)
 * @param data AsyncWorkData containing account ID
 */
static void ExecuteValidation(napi_env env, void* data) {
    (void)env; // Unused in worker thread
    AsyncWorkData* work_data = (AsyncWorkData*)data;
    
    // Perform validation in background thread
    work_data->result = validate_entitlement(work_data->account_id);
}

/**
 * @brief Complete validation and resolve/reject promise
 * 
 * Converts ValidationResult to JavaScript object and resolves promise.
 * 
 * @param env Node-API environment
 * @param status Async work completion status
 * @param data AsyncWorkData containing validation result
 */
static void CompleteValidation(napi_env env, napi_status status, void* data) {
    AsyncWorkData* work_data = (AsyncWorkData*)data;
    napi_value result_obj;
    napi_status napi_result;
    
    if (status != napi_ok || !work_data->result) {
        // Async work failed - reject with fail-closed response
        log_message(LOG_LEVEL_ERROR, "Async validation work failed or returned null result");
        
        napi_result = napi_create_object(env, &result_obj);
        if (napi_result != napi_ok) {
            log_message(LOG_LEVEL_ERROR, "Failed to create result object for failed validation");
            // Cannot create object - reject with null
            napi_reject_deferred(env, work_data->deferred, NULL);
            goto cleanup;
        }
        
        napi_value entitled_val;
        napi_result = napi_get_boolean(env, false, &entitled_val);
        if (napi_result == napi_ok) {
            napi_set_named_property(env, result_obj, "entitled", entitled_val);
        }
        
        napi_value message_val;
        napi_result = napi_create_string_utf8(env, "System error", NAPI_AUTO_LENGTH, &message_val);
        if (napi_result == napi_ok) {
            napi_set_named_property(env, result_obj, "message", message_val);
        }
        
        napi_resolve_deferred(env, work_data->deferred, result_obj);
    } else {
        // Convert ValidationResult to JavaScript object
        napi_result = napi_create_object(env, &result_obj);
        if (napi_result != napi_ok) {
            log_message(LOG_LEVEL_ERROR, "Failed to create result object for successful validation");
            napi_reject_deferred(env, work_data->deferred, NULL);
            goto cleanup;
        }
        
        // Set entitled property
        napi_value entitled_val;
        napi_result = napi_get_boolean(env, work_data->result->entitled, &entitled_val);
        if (napi_result == napi_ok) {
            napi_set_named_property(env, result_obj, "entitled", entitled_val);
        } else {
            log_message(LOG_LEVEL_ERROR, "Failed to create entitled boolean value");
        }
        
        // Set layer_arn property (nullable)
        if (work_data->result->layer_arn) {
            napi_value layer_arn_val;
            napi_result = napi_create_string_utf8(env, work_data->result->layer_arn, NAPI_AUTO_LENGTH, &layer_arn_val);
            if (napi_result == napi_ok) {
                napi_set_named_property(env, result_obj, "layerArn", layer_arn_val);
            } else {
                log_message(LOG_LEVEL_ERROR, "Failed to create layerArn string value");
            }
        }
        
        // Set message property (nullable)
        if (work_data->result->message) {
            napi_value message_val;
            napi_result = napi_create_string_utf8(env, work_data->result->message, NAPI_AUTO_LENGTH, &message_val);
            if (napi_result == napi_ok) {
                napi_set_named_property(env, result_obj, "message", message_val);
            } else {
                log_message(LOG_LEVEL_ERROR, "Failed to create message string value");
            }
        }
        
        // Set expires_at property (nullable)
        if (work_data->result->expires_at) {
            napi_value expires_at_val;
            napi_result = napi_create_string_utf8(env, work_data->result->expires_at, NAPI_AUTO_LENGTH, &expires_at_val);
            if (napi_result == napi_ok) {
                napi_set_named_property(env, result_obj, "expiresAt", expires_at_val);
            } else {
                log_message(LOG_LEVEL_ERROR, "Failed to create expiresAt string value");
            }
        }
        
        napi_resolve_deferred(env, work_data->deferred, result_obj);
        log_message(LOG_LEVEL_DEBUG, "Validation result successfully converted to JavaScript object");
    }
    
cleanup:
    // Cleanup
    if (work_data->result) {
        free_validation_result(work_data->result);
    }
    if (work_data->work) {
        napi_delete_async_work(env, work_data->work);
    }
    free(work_data);
}

/**
 * @brief Module cleanup function
 * 
 * Called when the module is being unloaded to clean up resources.
 * 
 * @param data User data (unused)
 */
static void ModuleCleanup(void* data) {
    (void)data; // Unused parameter
    
    // Cleanup network resources including connection sharing
    cleanup_network_resources();
    
    // Cleanup cache
    cache_cleanup();
    
    log_message(LOG_LEVEL_DEBUG, "Native licensing validator module cleanup completed");
}

/**
 * @brief Module initialization function
 * 
 * Registers the checkEntitlement function as the module export and sets up cleanup.
 * 
 * @param env Node-API environment
 * @param exports Module exports object
 * @return Module exports object
 */
static napi_value Init(napi_env env, napi_value exports) {
    napi_status status;
    napi_value fn;
    
    // Initialize cache
    cache_init();
    
    // Register cleanup callback
    status = napi_add_env_cleanup_hook(env, ModuleCleanup, NULL);
    if (status != napi_ok) {
        // Non-fatal error - log but continue
        log_message(LOG_LEVEL_WARN, "Failed to register cleanup hook, resources may not be cleaned up properly");
    }
    
    // Create checkEntitlement function
    status = napi_create_function(env, NULL, 0, CheckEntitlement, NULL, &fn);
    if (status != napi_ok) {
        napi_throw_error(env, "INIT_ERROR", "Failed to create checkEntitlement function");
        return NULL;
    }
    
    // Set as module export
    status = napi_set_named_property(env, exports, "checkEntitlement", fn);
    if (status != napi_ok) {
        napi_throw_error(env, "INIT_ERROR", "Failed to set checkEntitlement export");
        return NULL;
    }
    
    // Create checkEntitlementSync function (synchronous version for CDK synthesis)
    napi_value fn_sync;
    status = napi_create_function(env, NULL, 0, CheckEntitlementSync, NULL, &fn_sync);
    if (status != napi_ok) {
        napi_throw_error(env, "INIT_ERROR", "Failed to create checkEntitlementSync function");
        return NULL;
    }
    
    // Set sync function as module export
    status = napi_set_named_property(env, exports, "checkEntitlementSync", fn_sync);
    if (status != napi_ok) {
        napi_throw_error(env, "INIT_ERROR", "Failed to set checkEntitlementSync export");
        return NULL;
    }
    
    return exports;
}

// Register module
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)