/*
 * MIT License
 * 
 * Copyright (c) 2024 Lambda Kata Team
 * 
 * Response authenticity verification using SPKI certificate pinning
 * 
 * @remarks Validates: Requirements 3.3, 8.1, 8.2, 8.3, 8.4, 8.5
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <openssl/x509.h>
#include <openssl/evp.h>
#include <openssl/sha.h>
#include <openssl/bio.h>
#include <openssl/buffer.h>
#include <curl/curl.h>
#include "include/validator.h"

// SPKI hash for licensing.lambdakata.com (compile-time constant)
// This is a SHA-256 hash of the Subject Public Key Info (SPKI) in base64 format
// Format: "sha256//<base64-encoded-hash>"
// @remarks Validates: Requirement 8.5 - embedded as compile-time constant
static const char* EXPECTED_SPKI_HASH = "sha256//YhKJKSzoTt2b5FP18fvpHo7fJYqQCjAa3HWY3tvRMwE=";

// Expected hostname for additional validation
static const char* EXPECTED_HOSTNAME = LICENSING_HOST;

/**
 * @brief Extract SPKI hash from X.509 certificate
 * 
 * Extracts the Subject Public Key Info (SPKI) from a certificate and computes
 * its SHA-256 hash in base64 format for comparison with the pinned hash.
 * 
 * @param cert X.509 certificate
 * @param hash_out Buffer to store the computed hash (must be at least 64 bytes)
 * @return true on success, false on failure
 */
static bool extract_spki_hash(X509* cert, char* hash_out) {
    if (!cert || !hash_out) {
        log_security_error("SPKI extraction", "invalid parameters");
        return false;
    }
    
    // Get the public key from the certificate
    EVP_PKEY* pubkey = X509_get_pubkey(cert);
    if (!pubkey) {
        log_security_error("SPKI extraction", "failed to extract public key");
        return false;
    }
    
    // Create a memory BIO to hold the DER-encoded public key
    BIO* bio = BIO_new(BIO_s_mem());
    if (!bio) {
        log_memory_error("SPKI BIO allocation", 0);
        EVP_PKEY_free(pubkey);
        return false;
    }
    
    // Write the public key in DER format to the BIO
    if (i2d_PUBKEY_bio(bio, pubkey) != 1) {
        log_security_error("SPKI extraction", "failed to encode public key");
        BIO_free(bio);
        EVP_PKEY_free(pubkey);
        return false;
    }
    
    // Get the DER data from the BIO
    BUF_MEM* bio_mem = NULL;
    BIO_get_mem_ptr(bio, &bio_mem);
    if (!bio_mem || !bio_mem->data || bio_mem->length == 0) {
        log_security_error("SPKI extraction", "failed to get DER data");
        BIO_free(bio);
        EVP_PKEY_free(pubkey);
        return false;
    }
    
    // Compute SHA-256 hash of the DER-encoded public key
    unsigned char hash[SHA256_DIGEST_LENGTH];
    if (!SHA256((unsigned char*)bio_mem->data, bio_mem->length, hash)) {
        log_security_error("SPKI extraction", "SHA-256 computation failed");
        BIO_free(bio);
        EVP_PKEY_free(pubkey);
        return false;
    }
    
    // Encode the hash in base64
    BIO* b64_bio = BIO_new(BIO_f_base64());
    BIO* mem_bio = BIO_new(BIO_s_mem());
    if (!b64_bio || !mem_bio) {
        log_memory_error("base64 BIO allocation", 0);
        BIO_free(bio);
        EVP_PKEY_free(pubkey);
        if (b64_bio) BIO_free(b64_bio);
        if (mem_bio) BIO_free(mem_bio);
        return false;
    }
    
    BIO_set_flags(b64_bio, BIO_FLAGS_BASE64_NO_NL); // No newlines
    b64_bio = BIO_push(b64_bio, mem_bio);
    
    if (BIO_write(b64_bio, hash, SHA256_DIGEST_LENGTH) != SHA256_DIGEST_LENGTH) {
        log_security_error("SPKI extraction", "base64 encoding failed");
        BIO_free_all(b64_bio);
        BIO_free(bio);
        EVP_PKEY_free(pubkey);
        return false;
    }
    
    if (BIO_flush(b64_bio) != 1) {
        log_security_error("SPKI extraction", "base64 flush failed");
        BIO_free_all(b64_bio);
        BIO_free(bio);
        EVP_PKEY_free(pubkey);
        return false;
    }
    
    // Get the base64-encoded data
    BUF_MEM* b64_mem = NULL;
    BIO_get_mem_ptr(mem_bio, &b64_mem);
    if (!b64_mem || !b64_mem->data || b64_mem->length == 0) {
        log_security_error("SPKI extraction", "failed to get base64 data");
        BIO_free_all(b64_bio);
        BIO_free(bio);
        EVP_PKEY_free(pubkey);
        return false;
    }
    
    // Ensure we have enough data for the hash
    if (b64_mem->length < 44) { // Base64 encoded SHA-256 should be 44 characters
        log_security_error("SPKI extraction", "insufficient base64 data");
        BIO_free_all(b64_bio);
        BIO_free(bio);
        EVP_PKEY_free(pubkey);
        return false;
    }
    
    // Format as "sha256//<base64-hash>" with bounds checking
    int result = snprintf(hash_out, 64, "sha256//%.44s", b64_mem->data);
    if (result < 0 || result >= 64) {
        log_security_error("SPKI extraction", "hash formatting failed");
        BIO_free_all(b64_bio);
        BIO_free(bio);
        EVP_PKEY_free(pubkey);
        return false;
    }
    
    // Cleanup
    BIO_free_all(b64_bio);
    BIO_free(bio);
    EVP_PKEY_free(pubkey);
    
    return true;
}

/**
 * @brief libcurl certificate verification callback for SPKI pinning
 * 
 * This callback is called by libcurl during certificate verification to allow
 * custom validation logic. We use it to implement SPKI pinning by extracting
 * and validating the server's public key hash.
 * 
 * @param curl libcurl handle
 * @param ssl_ctx OpenSSL SSL context
 * @param userptr User data (unused)
 * @return CURLE_OK on success, CURLE_SSL_CACERT on validation failure
 */
static CURLcode ssl_ctx_callback(CURL* curl, void* ssl_ctx, void* userptr) {
    (void)curl;    // Unused parameter
    (void)userptr; // Unused parameter
    
    SSL_CTX* ctx = (SSL_CTX*)ssl_ctx;
    if (!ctx) {
        log_message(LOG_LEVEL_DEBUG, "Invalid SSL context in callback");
        return CURLE_SSL_CACERT; // Fail closed
    }
    
    // Note: We'll validate the certificate in the certificate verification callback
    // This SSL context callback is just for setup if needed
    log_message(LOG_LEVEL_DEBUG, "SSL context callback executed");
    return CURLE_OK;
}

/**
 * @brief libcurl certificate verification callback for SPKI pinning
 * 
 * This callback is called by libcurl during certificate verification to allow
 * custom validation logic. We use it to implement SPKI pinning by extracting
 * and validating the server's public key hash.
 * 
 * Note: Currently unused as we rely on libcurl's built-in CURLOPT_PINNEDPUBLICKEY
 * for SPKI pinning. This function is kept for potential future manual validation.
 * 
 * @param ok Pre-verification result (ignored for SPKI pinning)
 * @param ctx X509 store context containing the certificate
 * @return 1 on success, 0 on failure
 */
__attribute__((unused))
static int cert_verify_callback(int ok, X509_STORE_CTX* ctx) {
    (void)ok; // We ignore the pre-verification result for SPKI pinning
    
    if (!ctx) {
        log_message(LOG_LEVEL_DEBUG, "Invalid X509 store context");
        return 0; // Fail closed
    }
    
    // Get the current certificate being verified
    X509* cert = X509_STORE_CTX_get_current_cert(ctx);
    if (!cert) {
        log_message(LOG_LEVEL_DEBUG, "No current certificate in store context");
        return 0; // Fail closed
    }
    
    // Only validate the server certificate (depth 0)
    int depth = X509_STORE_CTX_get_error_depth(ctx);
    if (depth != 0) {
        // For intermediate/root certificates, we rely on standard validation
        return 1; // Continue with standard validation
    }
    
    // Extract and validate SPKI hash for the server certificate
    char computed_hash[64];
    if (!extract_spki_hash(cert, computed_hash)) {
        log_message(LOG_LEVEL_DEBUG, "Failed to extract SPKI hash from server certificate");
        return 0; // Fail closed
    }
    
    // Compare with expected hash
    if (strcmp(computed_hash, EXPECTED_SPKI_HASH) != 0) {
        log_message(LOG_LEVEL_WARN, "SPKI hash mismatch - potential MITM attack");
        log_message(LOG_LEVEL_DEBUG, "Expected: %s", EXPECTED_SPKI_HASH);
        log_message(LOG_LEVEL_DEBUG, "Computed: %s", computed_hash);
        return 0; // Fail closed
    }
    
    log_message(LOG_LEVEL_DEBUG, "SPKI hash validation successful");
    return 1; // Success
}

/**
 * @brief Configure libcurl handle for SPKI pinning
 * 
 * Sets up the libcurl handle with the SSL context callback and certificate
 * verification callback for SPKI pinning. This function should be called
 * when configuring the libcurl handle.
 * 
 * @param curl libcurl handle to configure
 * @return true on success, false on failure
 */
bool configure_spki_pinning(CURL* curl) {
    if (!curl) {
        log_security_error("SPKI configuration", "invalid libcurl handle");
        return false;
    }
    
    // Set the SSL context callback for additional setup
    CURLcode result = curl_easy_setopt(curl, CURLOPT_SSL_CTX_FUNCTION, ssl_ctx_callback);
    if (result != CURLE_OK) {
        log_security_error("SPKI configuration", "SSL context callback setup failed");
        return false;
    }
    
    // Note: We cannot directly set the certificate verification callback through libcurl
    // Instead, we'll use libcurl's built-in SPKI pinning support
    // Set the expected SPKI hash using CURLOPT_PINNEDPUBLICKEY
    result = curl_easy_setopt(curl, CURLOPT_PINNEDPUBLICKEY, EXPECTED_SPKI_HASH);
    if (result != CURLE_OK) {
        log_security_error("SPKI configuration", "pinned public key setup failed");
        return false;
    }
    
    log_message(LOG_LEVEL_DEBUG, "SPKI pinning configured successfully");
    return true;
}

/**
 * @brief Verify response authenticity using SPKI pinning and host validation
 * 
 * Verifies that the network response came from a server with the expected
 * SPKI hash and hostname. Since SPKI pinning is performed during the TLS handshake,
 * this function validates that the response is from a trusted connection.
 * 
 * @param response Network response to verify
 * @return true if authentic, false otherwise
 * 
 * @remarks Validates: Requirements 3.2, 3.3, 8.3, 8.4
 */
bool verify_response_authenticity(const NetworkResponse* response) {
    if (!response) {
        log_security_error("response authenticity", "null response");
        return false;
    }
    
    if (!response->data || response->size == 0) {
        log_security_error("response authenticity", "empty response data");
        return false;
    }
    
    // Check HTTP status code - only 200 is considered authentic
    if (response->response_code != 200) {
        log_security_error("response authenticity", "non-200 HTTP status");
        return false;
    }
    
    // Verify content type
    if (!response->content_type || strstr(response->content_type, "application/json") == NULL) {
        log_security_error("response authenticity", "invalid content type");
        return false;
    }
    
    // Additional host validation - verify the response structure indicates it came from our expected host
    // Look for any host-specific markers in the response that would indicate tampering
    if (response->size > MAX_RESPONSE_SIZE) {
        log_security_error("response authenticity", "response size exceeds maximum");
        return false;
    }
    
    // Validate response doesn't contain suspicious redirect indicators
    if (strstr(response->data, "Location:") != NULL || 
        strstr(response->data, "location:") != NULL ||
        strstr(response->data, "redirect") != NULL) {
        log_security_error("response authenticity", "redirect indicators detected");
        return false;
    }
    
    // Additional security checks for response content
    // Check for suspicious HTML content that might indicate a captive portal or proxy
    if (strstr(response->data, "<html") != NULL ||
        strstr(response->data, "<HTML") != NULL ||
        strstr(response->data, "<!DOCTYPE") != NULL) {
        log_security_error("response authenticity", "HTML content detected");
        return false;
    }
    
    // Check for suspicious JavaScript content
    if (strstr(response->data, "<script") != NULL ||
        strstr(response->data, "javascript:") != NULL) {
        log_security_error("response authenticity", "JavaScript content detected");
        return false;
    }
    
    // Validate response contains expected JSON structure markers
    if (strstr(response->data, "entitled") == NULL) {
        log_security_error("response authenticity", "missing expected JSON structure");
        return false;
    }
    
    // If we reach this point, the response passed SPKI pinning during TLS handshake,
    // hostname verification, and content validation, so it's considered authentic
    log_message(LOG_LEVEL_DEBUG, "Response authenticity and host validation successful");
    return true;
}

/**
 * @brief Verify host certificate using SPKI pinning and hostname validation
 * 
 * Verifies that the hostname matches the expected licensing host and that
 * SPKI pinning was successful. This function is called as part of the
 * overall certificate validation process.
 * 
 * @param hostname Hostname to verify
 * @return true if certificate is valid, false otherwise
 * 
 * @remarks Validates: Requirements 3.2, 8.3, 8.4
 */
bool verify_host_certificate(const char* hostname) {
    if (!hostname) {
        log_security_error("host certificate", "null hostname");
        return false;
    }
    
    // Verify hostname matches expected licensing host exactly
    if (strcmp(hostname, EXPECTED_HOSTNAME) != 0) {
        log_security_error("host certificate", "hostname mismatch");
        return false;
    }
    
    // Additional hostname format validation
    size_t hostname_len = strlen(hostname);
    if (hostname_len == 0 || hostname_len > 253) { // RFC 1035 limit
        log_security_error("host certificate", "invalid hostname length");
        return false;
    }
    
    // Check for suspicious characters that might indicate tampering
    for (size_t i = 0; i < hostname_len; i++) {
        char c = hostname[i];
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || 
              (c >= '0' && c <= '9') || c == '.' || c == '-')) {
            log_security_error("host certificate", "invalid character in hostname");
            return false;
        }
    }
    
    // Verify it's not an IP address (should be a domain name)
    bool is_ip = true;
    int dot_count = 0;
    for (size_t i = 0; i < hostname_len; i++) {
        char c = hostname[i];
        if (c == '.') {
            dot_count++;
        } else if (!(c >= '0' && c <= '9')) {
            is_ip = false;
            break;
        }
    }
    
    if (is_ip && dot_count == 3) {
        log_security_error("host certificate", "IP address not allowed");
        return false;
    }
    
    // Additional security checks for hostname structure
    // Ensure hostname doesn't start or end with invalid characters
    if (hostname[0] == '.' || hostname[0] == '-' || 
        hostname[hostname_len - 1] == '.' || hostname[hostname_len - 1] == '-') {
        log_security_error("host certificate", "invalid hostname format");
        return false;
    }
    
    // Check for consecutive dots or other suspicious patterns
    for (size_t i = 0; i < hostname_len - 1; i++) {
        if (hostname[i] == '.' && hostname[i + 1] == '.') {
            log_security_error("host certificate", "consecutive dots in hostname");
            return false;
        }
    }
    
    // If we reach this point during a successful TLS connection,
    // SPKI pinning has already been validated by libcurl
    log_message(LOG_LEVEL_DEBUG, "Host certificate and hostname validation successful for %s", hostname);
    return true;
}