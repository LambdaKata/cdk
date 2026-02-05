/*
 * MIT License
 * 
 * Copyright (c) 2024 Lambda Kata Team
 * 
 * Response caching with 5-minute TTL (stub implementation)
 * 
 * @remarks Validates: Requirements 10.5
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "include/validator.h"

// Static cache storage
static CacheEntry cache[CACHE_SIZE];
static bool cache_initialized = false;

/**
 * @brief Initialize the cache
 * 
 * Sets up the cache data structure with empty entries.
 * This function is called once during module initialization.
 */
void cache_init(void) {
    if (cache_initialized) {
        return;
    }
    
    // Initialize all cache entries as invalid
    for (int i = 0; i < CACHE_SIZE; i++) {
        cache[i].valid = false;
        cache[i].expires_at = 0;
        memset(cache[i].account_id, 0, sizeof(cache[i].account_id));
        
        // Initialize result structure
        cache[i].result.entitled = false;
        cache[i].result.layer_arn = NULL;
        cache[i].result.message = NULL;
        cache[i].result.expires_at = NULL;
        cache[i].result.error_code = ERROR_NONE;
    }
    
    cache_initialized = true;
    log_message(LOG_LEVEL_DEBUG, "Cache initialized with %d entries", CACHE_SIZE);
}

/**
 * @brief Find cache entry for account ID
 * 
 * Searches the cache for a valid entry matching the account ID.
 * 
 * @param account_id Account ID to search for
 * @return Cache entry index or -1 if not found
 */
static int find_cache_entry(const char* account_id) {
    if (!account_id || !cache_initialized) {
        return -1;
    }
    
    time_t now = time(NULL);
    
    for (int i = 0; i < CACHE_SIZE; i++) {
        if (cache[i].valid && 
            strcmp(cache[i].account_id, account_id) == 0 &&
            cache[i].expires_at > now) {
            return i;
        }
    }
    
    return -1;
}

/**
 * @brief Find least recently used cache entry
 * 
 * Implements simple LRU eviction by finding the entry with the oldest expiration.
 * 
 * @return Cache entry index for replacement
 */
static int find_lru_entry(void) {
    int lru_index = 0;
    time_t oldest_expiration = cache[0].expires_at;
    
    for (int i = 1; i < CACHE_SIZE; i++) {
        if (!cache[i].valid) {
            return i; // Use invalid entry first
        }
        
        if (cache[i].expires_at < oldest_expiration) {
            oldest_expiration = cache[i].expires_at;
            lru_index = i;
        }
    }
    
    return lru_index;
}

/**
 * @brief Get cached validation result
 * 
 * Retrieves a cached validation result if available and not expired.
 * 
 * @param account_id Account ID to look up
 * @return ValidationResult pointer or NULL if not cached
 */
ValidationResult* cache_get(const char* account_id) {
    if (!cache_initialized) {
        cache_init();
    }
    
    int index = find_cache_entry(account_id);
    if (index == -1) {
        log_message(LOG_LEVEL_DEBUG, "Cache miss for account ID");
        return NULL;
    }
    
    log_message(LOG_LEVEL_DEBUG, "Cache hit for account ID");
    return &cache[index].result;
}

/**
 * @brief Store validation result in cache
 * 
 * Caches a validation result with 5-minute TTL.
 * Only successful results are cached to avoid caching transient failures.
 * 
 * @param account_id Account ID to cache
 * @param result Validation result to cache
 */
void cache_put(const char* account_id, const ValidationResult* result) {
    if (!cache_initialized) {
        cache_init();
    }
    
    if (!account_id || !result) {
        log_message(LOG_LEVEL_DEBUG, "Cannot cache NULL account ID or result");
        return;
    }
    
    // Only cache successful results (entitled = true)
    // This prevents caching transient network failures
    if (!result->entitled) {
        log_message(LOG_LEVEL_DEBUG, "Not caching failed validation result");
        return;
    }
    
    // Find entry to use (existing or LRU)
    int index = find_cache_entry(account_id);
    if (index == -1) {
        index = find_lru_entry();
        
        // Clean up existing entry if valid
        if (cache[index].valid) {
            free(cache[index].result.layer_arn);
            free(cache[index].result.message);
            free(cache[index].result.expires_at);
        }
    }
    
    // Store account ID
    strncpy(cache[index].account_id, account_id, sizeof(cache[index].account_id) - 1);
    cache[index].account_id[sizeof(cache[index].account_id) - 1] = '\0';
    
    // Store result (deep copy with error handling)
    cache[index].result.entitled = result->entitled;
    cache[index].result.error_code = result->error_code;
    
    // Handle memory allocation failures gracefully
    if (result->layer_arn) {
        cache[index].result.layer_arn = strdup(result->layer_arn);
        if (!cache[index].result.layer_arn) {
            log_memory_error("cache layer_arn allocation", strlen(result->layer_arn) + 1);
            // Continue without caching this field
        }
    } else {
        cache[index].result.layer_arn = NULL;
    }
    
    if (result->message) {
        cache[index].result.message = strdup(result->message);
        if (!cache[index].result.message) {
            log_memory_error("cache message allocation", strlen(result->message) + 1);
            // Continue without caching this field
        }
    } else {
        cache[index].result.message = NULL;
    }
    
    if (result->expires_at) {
        cache[index].result.expires_at = strdup(result->expires_at);
        if (!cache[index].result.expires_at) {
            log_memory_error("cache expires_at allocation", strlen(result->expires_at) + 1);
            // Continue without caching this field
        }
    } else {
        cache[index].result.expires_at = NULL;
    }
    
    // Set expiration (5 minutes from now)
    time_t now = time(NULL);
    if (now == (time_t)-1) {
        log_message(LOG_LEVEL_WARN, "Failed to get current time for cache expiration");
        // Use a reasonable default (current time + TTL)
        cache[index].expires_at = 0 + CACHE_TTL_SECONDS;
    } else {
        cache[index].expires_at = now + CACHE_TTL_SECONDS;
    }
    
    cache[index].valid = true;
    
    log_message(LOG_LEVEL_DEBUG, "Cached validation result for account ID");
}

/**
 * @brief Clean up cache resources
 * 
 * Frees all allocated memory in the cache.
 * This function is called during module cleanup.
 */
void cache_cleanup(void) {
    if (!cache_initialized) {
        return;
    }
    
    for (int i = 0; i < CACHE_SIZE; i++) {
        if (cache[i].valid) {
            free(cache[i].result.layer_arn);
            free(cache[i].result.message);
            free(cache[i].result.expires_at);
            cache[i].valid = false;
        }
    }
    
    cache_initialized = false;
    log_message(LOG_LEVEL_DEBUG, "Cache cleanup completed");
}