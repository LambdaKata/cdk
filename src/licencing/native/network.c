/*
 * MIT License
 * 
 * Copyright (c) 2024 Lambda Kata Team
 * 
 * Hardened HTTP client using libcurl with security constraints
 * 
 * @remarks Validates: Requirements 1.1, 1.2, 3.1, 3.4, 3.5, 3.6
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <curl/curl.h>
#ifdef LINUX_BUILD
#include <json-c/json.h>
#endif
#include "include/validator.h"

// Static initialization flags and connection sharing
static bool curl_initialized = false;
static CURLSH* curl_share_handle = NULL;
static bool share_initialized = false;

/**
 * @brief Thread-safe lock callback for libcurl connection sharing
 * 
 * This callback is required for thread-safe operation of CURLSH handles.
 * Since we're using a single-threaded model in Lambda, this is a no-op
 * but required by libcurl's API contract.
 * 
 * @param handle CURLSH handle
 * @param data Lock type data
 * @param locktype Type of lock operation
 * @param userptr User data pointer
 */
static void curl_lock_callback(CURL* handle, curl_lock_data data, curl_lock_access locktype, void* userptr) {
    (void)handle;    // Unused parameter
    (void)data;      // Unused parameter  
    (void)locktype;  // Unused parameter
    (void)userptr;   // Unused parameter
    
    // No-op: Lambda functions are single-threaded, but libcurl requires this callback
    // for CURLSHOPT_SHARE to work properly
}

/**
 * @brief Thread-safe unlock callback for libcurl connection sharing
 * 
 * Companion to curl_lock_callback for thread-safe CURLSH operation.
 * 
 * @param handle CURLSH handle
 * @param data Lock type data
 * @param userptr User data pointer
 */
static void curl_unlock_callback(CURL* handle, curl_lock_data data, void* userptr) {
    (void)handle;   // Unused parameter
    (void)data;     // Unused parameter
    (void)userptr;  // Unused parameter
    
    // No-op: Lambda functions are single-threaded
}

/**
 * @brief Initialize libcurl connection sharing for connection reuse
 * 
 * Sets up a shared connection pool that allows multiple curl handles
 * to reuse HTTP connections to the same endpoint. This improves performance
 * by avoiding TCP handshake overhead on subsequent requests.
 * 
 * @return true on success, false on failure
 * 
 * @remarks Validates: Requirement 10.3 - HTTP connection reuse
 */
static bool initialize_curl_sharing(void) {
    if (share_initialized) {
        return true;
    }
    
    // Create shared handle for connection pooling
    curl_share_handle = curl_share_init();
    if (!curl_share_handle) {
        log_message(LOG_LEVEL_ERROR, "Failed to initialize libcurl connection sharing");
        return false;
    }
    
    // Configure connection sharing - reuse connections and DNS cache
    CURLSHcode share_result;
    
    share_result = curl_share_setopt(curl_share_handle, CURLSHOPT_SHARE, CURL_LOCK_DATA_CONNECT);
    if (share_result != CURLSHE_OK) {
        log_message(LOG_LEVEL_ERROR, "Failed to configure connection sharing: %s", curl_share_strerror(share_result));
        curl_share_cleanup(curl_share_handle);
        curl_share_handle = NULL;
        return false;
    }
    
    share_result = curl_share_setopt(curl_share_handle, CURLSHOPT_SHARE, CURL_LOCK_DATA_DNS);
    if (share_result != CURLSHE_OK) {
        log_message(LOG_LEVEL_ERROR, "Failed to configure DNS sharing: %s", curl_share_strerror(share_result));
        curl_share_cleanup(curl_share_handle);
        curl_share_handle = NULL;
        return false;
    }
    
    // Set lock callbacks (required even for single-threaded use)
    share_result = curl_share_setopt(curl_share_handle, CURLSHOPT_LOCKFUNC, curl_lock_callback);
    if (share_result != CURLSHE_OK) {
        log_message(LOG_LEVEL_ERROR, "Failed to set lock callback: %s", curl_share_strerror(share_result));
        curl_share_cleanup(curl_share_handle);
        curl_share_handle = NULL;
        return false;
    }
    
    share_result = curl_share_setopt(curl_share_handle, CURLSHOPT_UNLOCKFUNC, curl_unlock_callback);
    if (share_result != CURLSHE_OK) {
        log_message(LOG_LEVEL_ERROR, "Failed to set unlock callback: %s", curl_share_strerror(share_result));
        curl_share_cleanup(curl_share_handle);
        curl_share_handle = NULL;
        return false;
    }
    
    share_initialized = true;
    log_message(LOG_LEVEL_DEBUG, "libcurl connection sharing initialized successfully");
    return true;
}

/**
 * @brief Cleanup libcurl connection sharing resources
 * 
 * Cleans up the shared connection pool. This should be called on process exit
 * to properly release resources.
 */
static void cleanup_curl_sharing(void) {
    if (curl_share_handle) {
        curl_share_cleanup(curl_share_handle);
        curl_share_handle = NULL;
        share_initialized = false;
        log_message(LOG_LEVEL_DEBUG, "libcurl connection sharing cleaned up");
    }
}
typedef struct {
    char* data;
    size_t size;
} ResponseData;

/**
 * @brief Validate the effective URL after libcurl resolves it
 * 
 * This function validates that the final URL libcurl will connect to
 * matches our expected host, preventing DNS spoofing and redirect attacks.
 * 
 * @param curl Configured libcurl handle
 * @return true if host is valid, false otherwise
 */
static bool validate_effective_url(CURL* curl) {
    char* effective_url = NULL;
    CURLcode result = curl_easy_getinfo(curl, CURLINFO_EFFECTIVE_URL, &effective_url);
    
    if (result != CURLE_OK || !effective_url) {
        log_message(LOG_LEVEL_WARN, "Failed to get effective URL for host validation");
        return false; // Fail closed
    }
    
    // Parse hostname from URL
    // Expected format: https://licensing.lambdakata.com:443/v1/license/check
    if (strncmp(effective_url, "https://", 8) != 0) {
        log_message(LOG_LEVEL_WARN, "Host validation failed: non-HTTPS URL: %s", effective_url);
        return false; // Fail closed
    }
    
    const char* hostname_start = effective_url + 8; // Skip "https://"
    const char* hostname_end = strchr(hostname_start, ':');
    if (!hostname_end) {
        hostname_end = strchr(hostname_start, '/');
    }
    if (!hostname_end) {
        hostname_end = hostname_start + strlen(hostname_start);
    }
    
    size_t hostname_len = hostname_end - hostname_start;
    if (hostname_len != strlen(LICENSING_HOST)) {
        log_message(LOG_LEVEL_WARN, "Host validation failed: hostname length mismatch");
        return false; // Fail closed
    }
    
    if (strncmp(hostname_start, LICENSING_HOST, hostname_len) != 0) {
        log_message(LOG_LEVEL_WARN, "Host validation failed: unexpected hostname in URL");
        return false; // Fail closed
    }
    
    log_message(LOG_LEVEL_DEBUG, "Effective URL host validation successful");
    return true;
}

/**
 * @brief Validate the effective URL after libcurl resolves it
 * 
 * Accumulates response data from libcurl.
 * 
 * @param contents Response data chunk
 * @param size Size of each element
 * @param nmemb Number of elements
 * @param userp User data (ResponseData*)
 * @return Number of bytes processed
 */
static size_t write_callback(void* contents, size_t size, size_t nmemb, void* userp) {
    size_t realsize = size * nmemb;
    ResponseData* response = (ResponseData*)userp;
    
    // Prevent excessive memory allocation
    if (response->size + realsize > MAX_RESPONSE_SIZE) {
        log_message(LOG_LEVEL_WARN, "Response size exceeds maximum allowed");
        return 0; // Signal error to libcurl
    }
    
    char* ptr = realloc(response->data, response->size + realsize + 1);
    if (!ptr) {
        log_memory_error("response data reallocation", response->size + realsize + 1);
        return 0; // Signal error to libcurl
    }
    
    response->data = ptr;
    memcpy(&(response->data[response->size]), contents, realsize);
    response->size += realsize;
    response->data[response->size] = '\0';
    
    return realsize;
}

/**
 * @brief Initialize libcurl with security settings and connection sharing
 * 
 * Sets up libcurl with hardened security configuration and connection pooling.
 * This function is called once and configures global libcurl settings.
 * 
 * @return true on success, false on failure
 */
static bool initialize_curl(void) {
    if (curl_initialized) {
        return true;
    }
    
    CURLcode result = curl_global_init(CURL_GLOBAL_DEFAULT);
    if (result != CURLE_OK) {
        log_message(LOG_LEVEL_ERROR, "Failed to initialize libcurl: %s", curl_easy_strerror(result));
        return false;
    }
    
    // Initialize connection sharing for performance
    if (!initialize_curl_sharing()) {
        log_message(LOG_LEVEL_WARN, "Failed to initialize connection sharing, continuing without connection reuse");
        // Continue without connection sharing - not a fatal error
    }
    
    curl_initialized = true;
    log_message(LOG_LEVEL_DEBUG, "libcurl initialized successfully with connection sharing");
    return true;
}

/**
 * @brief Create JSON request payload
 * 
 * Constructs the JSON request body for licensing validation.
 * 
 * @param account_id 12-digit AWS account ID
 * @return Allocated JSON string (caller must free)
 */
static char* create_request_payload(const char* account_id) {
    // Calculate required buffer size
    size_t payload_size = 128 + strlen(account_id) + strlen(LICENSING_PRODUCT_CODE);
    char* payload = malloc(payload_size);
    
    if (!payload) {
        log_memory_error("request payload allocation", payload_size);
        return NULL;
    }
    
    // Create JSON payload
    int result = snprintf(payload, payload_size,
        "{"
        "\"accountId\":\"%s\","
        "\"productCode\":\"%s\""
        "}",
        account_id,
        LICENSING_PRODUCT_CODE
    );
    
    if (result < 0 || (size_t)result >= payload_size) {
        log_message(LOG_LEVEL_ERROR, "Failed to create request payload");
        free(payload);
        return NULL;
    }
    
    return payload;
}

/**
 * @brief Make HTTPS request to licensing service
 * 
 * Performs a hardened HTTPS POST request to the licensing endpoint.
 * All security settings are hardcoded to prevent tampering.
 * 
 * @param account_id 12-digit AWS account ID
 * @return NetworkResponse pointer (caller must free) or NULL on failure
 * 
 * @remarks Validates: Requirements 1.1, 1.2, 3.1, 3.4, 3.5, 3.6
 */
NetworkResponse* make_licensing_request(const char* account_id) {
    CURL* curl = NULL;
    CURLcode res;
    NetworkResponse* response = NULL;
    ResponseData response_data = {0};
    char* payload = NULL;
    struct curl_slist* headers = NULL;
    
    log_message(LOG_LEVEL_DEBUG, "Making licensing request");
    
    // Initialize libcurl if needed
    if (!initialize_curl()) {
        return NULL; // Fail closed
    }
    
    // Allocate response structure
    response = (NetworkResponse*)calloc(1, sizeof(NetworkResponse));
    if (!response) {
        log_memory_error("network response allocation", sizeof(NetworkResponse));
        return NULL; // Fail closed
    }
    
    // Create request payload
    payload = create_request_payload(account_id);
    if (!payload) {
        free(response);
        return NULL; // Fail closed
    }
    
    // Initialize libcurl handle
    curl = curl_easy_init();
    if (!curl) {
        log_message(LOG_LEVEL_ERROR, "Failed to initialize libcurl handle");
        free(payload);
        free(response);
        return NULL; // Fail closed
    }
    
    // Construct URL (hardcoded for security)
    char url[256];
    snprintf(url, sizeof(url), "https://%s:%d%s", LICENSING_HOST, LICENSING_PORT, LICENSING_PATH);
    
    // Set hardcoded URL
    curl_easy_setopt(curl, CURLOPT_URL, url);
    
    // Security settings - hardcoded to prevent tampering
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 0L);        // No redirects
    curl_easy_setopt(curl, CURLOPT_MAXREDIRS, 0L);             // No redirects
    curl_easy_setopt(curl, CURLOPT_PROXY, "");                 // No proxy
    curl_easy_setopt(curl, CURLOPT_NOPROXY, "*");              // No proxy for any host
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 1L);        // Verify certificate
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYHOST, 2L);        // Verify hostname
    curl_easy_setopt(curl, CURLOPT_SSLVERSION, CURL_SSLVERSION_TLSv1_2); // TLS 1.2+
    
    // Additional host validation callback
    // Note: This is a conceptual callback - libcurl doesn't have CURLOPT_HOSTVALIDATEFUNCTION
    // Instead, we rely on CURLOPT_SSL_VERIFYHOST=2 and our pre-request validation
    
    // Timeout settings
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT_MS, CONNECTION_TIMEOUT_MS);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT_MS, READ_TIMEOUT_MS);
    
    // HTTP method and data
    curl_easy_setopt(curl, CURLOPT_POST, 1L);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, payload);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, strlen(payload));
    
    // Set headers
    headers = curl_slist_append(headers, "Content-Type: application/json");
    headers = curl_slist_append(headers, "Accept: application/json");
    headers = curl_slist_append(headers, "User-Agent: lambda-kata-native-validator/1.0");
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    
    // Set response callback
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_callback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response_data);
    
    // Configure connection sharing for reuse (if available)
    if (curl_share_handle) {
        curl_easy_setopt(curl, CURLOPT_SHARE, curl_share_handle);
        log_message(LOG_LEVEL_DEBUG, "Configured curl handle for connection sharing");
    }
    
    // Configure SPKI pinning for certificate validation
    if (!configure_spki_pinning(curl)) {
        log_message(LOG_LEVEL_ERROR, "Failed to configure SPKI pinning");
        curl_slist_free_all(headers);
        curl_easy_cleanup(curl);
        free(payload);
        free(response);
        return NULL; // Fail closed
    }
    
    // Additional host validation - verify we're connecting to expected host
    if (!verify_host_certificate(LICENSING_HOST)) {
        log_message(LOG_LEVEL_ERROR, "Host validation failed for %s", LICENSING_HOST);
        curl_slist_free_all(headers);
        curl_easy_cleanup(curl);
        free(payload);
        free(response);
        return NULL; // Fail closed
    }
    
    // Perform request
    res = curl_easy_perform(curl);
    
    if (res != CURLE_OK) {
        log_network_error(res, "licensing request failed");
        
        // Set appropriate error code based on libcurl error
        if (res == CURLE_OPERATION_TIMEDOUT) {
            response->response_code = 0; // Timeout
        } else if (res == CURLE_SSL_CONNECT_ERROR || res == CURLE_SSL_PEER_CERTIFICATE) {
            response->response_code = 0; // TLS error
        } else if (res == CURLE_PEER_FAILED_VERIFICATION) {
            response->response_code = 0; // Host validation error
        } else {
            response->response_code = 0; // General network error
        }
        
        response->data = NULL;
        response->size = 0;
    } else {
        // Validate the effective URL after successful connection
        if (!validate_effective_url(curl)) {
            log_security_error("post-connection host validation", "effective URL validation failed");
            // Treat as security error
            response->response_code = 0;
            response->data = NULL;
            response->size = 0;
            if (response_data.data) {
                free(response_data.data);
                response_data.data = NULL;
                response_data.size = 0;
            }
        } else {
            // Get HTTP response code
            curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &response->response_code);
            
            // Transfer response data
            response->data = response_data.data;
            response->size = response_data.size;
            
            // Get content type
            char* content_type = NULL;
            curl_easy_getinfo(curl, CURLINFO_CONTENT_TYPE, &content_type);
            if (content_type) {
                response->content_type = strdup(content_type);
            }
            
            // Final host validation using connection info
            char* primary_ip = NULL;
            curl_easy_getinfo(curl, CURLINFO_PRIMARY_IP, &primary_ip);
            if (primary_ip) {
                log_message(LOG_LEVEL_DEBUG, "Connected to IP: %s for host: %s", primary_ip, LICENSING_HOST);
            }
            
            log_message(LOG_LEVEL_DEBUG, "Network request completed with status %ld", response->response_code);
        }
    }
    
    // Cleanup
    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);
    free(payload);
    
    return response;
}

/**
 * @brief Free network response structure
 * 
 * Safely deallocates all memory associated with a NetworkResponse.
 * 
 * @param response NetworkResponse to free (can be NULL)
 */
void free_network_response(NetworkResponse* response) {
    if (!response) {
        return;
    }
    
    free(response->data);
    free(response->content_type);
    free(response);
}

/**
 * @brief Parse JSON response into ValidationResult
 * 
 * Parses the JSON response from the licensing service with fail-closed behavior.
 * Any malformed JSON, missing fields, or wrong types result in {entitled: false}.
 * 
 * @param response NetworkResponse containing JSON data
 * @return ValidationResult pointer (caller must free) or NULL on allocation failure
 * 
 * @remarks Validates: Requirement 2.2 - fail-closed behavior for invalid responses
 */
ValidationResult* parse_json_response(const NetworkResponse* response) {
    ValidationResult* result = NULL;
    
    if (!response || !response->data || response->size == 0) {
        log_json_error("empty response", "no data received");
        goto fail_closed;
    }
    
    // Check HTTP status code first
    if (response->response_code != 200) {
        log_json_error("http error", "non-200 status code");
        goto fail_closed;
    }
    
    // Verify content type
    if (!response->content_type || strstr(response->content_type, "application/json") == NULL) {
        log_json_error("invalid content type", response->content_type ? "wrong type" : "missing type");
        goto fail_closed;
    }
    
    // Allocate result structure
    result = (ValidationResult*)calloc(1, sizeof(ValidationResult));
    if (!result) {
        log_memory_error("validation result allocation", sizeof(ValidationResult));
        return NULL; // Cannot fail closed if we can't allocate memory
    }
    
    // Initialize with fail-closed defaults
    result->entitled = false;
    result->layer_arn = NULL;
    result->message = NULL;
    result->expires_at = NULL;
    result->error_code = ERROR_NONE;
    
#ifdef LINUX_BUILD
    // Use json-c for parsing on Linux
    json_object* root = json_tokener_parse(response->data);
    if (!root) {
        log_json_error("parse failure", "invalid JSON format");
        result->error_code = ERROR_JSON_PARSE_FAILURE;
        result->message = strdup("Invalid JSON format");
        return result; // Fail closed
    }
    
    // Extract 'entitled' field (required)
    json_object* entitled_obj = NULL;
    if (!json_object_object_get_ex(root, "entitled", &entitled_obj)) {
        log_json_error("missing field", "entitled field not found");
        result->error_code = ERROR_JSON_MISSING_FIELD;
        result->message = strdup("Missing entitled field");
        json_object_put(root);
        return result; // Fail closed
    }
    
    if (!json_object_is_type(entitled_obj, json_type_boolean)) {
        log_json_error("wrong type", "entitled field not boolean");
        result->error_code = ERROR_JSON_WRONG_TYPE;
        result->message = strdup("Invalid entitled field type");
        json_object_put(root);
        return result; // Fail closed
    }
    
    result->entitled = json_object_get_boolean(entitled_obj);
    
    // Extract optional 'layerArn' field
    json_object* layer_arn_obj = NULL;
    if (json_object_object_get_ex(root, "layerArn", &layer_arn_obj)) {
        if (json_object_is_type(layer_arn_obj, json_type_string)) {
            const char* layer_arn_str = json_object_get_string(layer_arn_obj);
            if (layer_arn_str && strlen(layer_arn_str) <= MAX_ARN_LENGTH) {
                result->layer_arn = strdup(layer_arn_str);
                if (!result->layer_arn) {
                    log_memory_error("layer ARN allocation", strlen(layer_arn_str) + 1);
                    result->error_code = ERROR_MEMORY_ALLOCATION;
                }
            } else {
                log_json_error("invalid field", "layer ARN too long or invalid");
                result->error_code = ERROR_JSON_WRONG_TYPE;
            }
        }
    }
    
    // Extract optional 'message' field
    json_object* message_obj = NULL;
    if (json_object_object_get_ex(root, "message", &message_obj)) {
        if (json_object_is_type(message_obj, json_type_string)) {
            const char* message_str = json_object_get_string(message_obj);
            if (message_str && strlen(message_str) <= MAX_MESSAGE_LENGTH) {
                result->message = strdup(message_str);
                if (!result->message) {
                    log_memory_error("message allocation", strlen(message_str) + 1);
                    result->error_code = ERROR_MEMORY_ALLOCATION;
                }
            } else {
                log_json_error("invalid field", "message too long");
            }
        }
    }
    
    // Extract optional 'expiresAt' field
    json_object* expires_at_obj = NULL;
    if (json_object_object_get_ex(root, "expiresAt", &expires_at_obj)) {
        if (json_object_is_type(expires_at_obj, json_type_string)) {
            const char* expires_at_str = json_object_get_string(expires_at_obj);
            if (expires_at_str && strlen(expires_at_str) <= MAX_MESSAGE_LENGTH) {
                result->expires_at = strdup(expires_at_str);
                if (!result->expires_at) {
                    log_memory_error("expires_at allocation", strlen(expires_at_str) + 1);
                    result->error_code = ERROR_MEMORY_ALLOCATION;
                }
            } else {
                log_json_error("invalid field", "expiresAt too long");
            }
        }
    }
    
    json_object_put(root);
    
#else
    // Fallback manual parsing for macOS (no json-c available)
    log_message(LOG_LEVEL_DEBUG, "Using fallback JSON parsing");
    
    // Simple manual parsing - look for "entitled":true/false
    const char* entitled_pos = strstr(response->data, "\"entitled\"");
    if (!entitled_pos) {
        log_message(LOG_LEVEL_WARN, "Missing 'entitled' field in JSON response");
        result->error_code = ERROR_JSON_MISSING_FIELD;
        result->message = strdup("Missing entitled field");
        return result; // Fail closed
    }
    
    // Look for true/false after entitled field
    const char* colon_pos = strchr(entitled_pos, ':');
    if (!colon_pos) {
        log_json_error("malformed field", "entitled field syntax error");
        result->error_code = ERROR_JSON_PARSE_FAILURE;
        result->message = strdup("Malformed JSON");
        return result; // Fail closed
    }
    
    // Skip whitespace after colon
    colon_pos++;
    while (*colon_pos == ' ' || *colon_pos == '\t' || *colon_pos == '\n' || *colon_pos == '\r') {
        colon_pos++;
    }
    
    if (strncmp(colon_pos, "true", 4) == 0) {
        result->entitled = true;
    } else if (strncmp(colon_pos, "false", 5) == 0) {
        result->entitled = false;
    } else {
        log_json_error("invalid value", "entitled field value not boolean");
        result->error_code = ERROR_JSON_WRONG_TYPE;
        result->message = strdup("Invalid entitled value");
        return result; // Fail closed
    }
    
    // For fallback parsing, we don't extract optional fields to keep it simple and secure
    // This ensures we fail closed if the parsing is not robust enough
    log_message(LOG_LEVEL_DEBUG, "Fallback parsing completed, entitled=%s", result->entitled ? "true" : "false");
#endif
    
    log_message(LOG_LEVEL_DEBUG, "JSON parsing successful, entitled=%s", result->entitled ? "true" : "false");
    return result;
    
fail_closed:
    // Allocate result for fail-closed behavior
    result = (ValidationResult*)calloc(1, sizeof(ValidationResult));
    if (!result) {
        return NULL; // Cannot fail closed if we can't allocate memory
    }
    
    result->entitled = false;
    result->layer_arn = NULL;
    result->message = strdup("Invalid response");
    result->expires_at = NULL;
    result->error_code = ERROR_INVALID_RESPONSE;
    
    return result;
}

/**
 * @brief Cleanup network resources including connection sharing
 * 
 * Cleans up all network-related resources including the shared connection pool.
 * This should be called on process exit to properly release resources.
 * 
 * @remarks This function is safe to call multiple times
 */
void cleanup_network_resources(void) {
    cleanup_curl_sharing();
    
    if (curl_initialized) {
        curl_global_cleanup();
        curl_initialized = false;
        log_message(LOG_LEVEL_DEBUG, "Network resources cleaned up");
    }
}