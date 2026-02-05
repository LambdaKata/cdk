{
  "targets": [
    {
      "target_name": "native_licensing_validator",
      "sources": [
        "native/napi_bridge.c",
        "native/validator.c",
        "native/network.c",
        "native/security.c",
        "native/cache.c",
        "native/logging.c"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "native/include"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS",
        "NAPI_VERSION=8"
      ],
      "cflags": [
        "-std=c11",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-O2",
        "-fPIC",
        "-D_GNU_SOURCE"
      ],
      "cflags_cc": [
        "-std=c++17",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-O2",
        "-fPIC"
      ],
      "conditions": [
        [
          "OS=='linux'",
          {
            "libraries": [
              "-lcurl",
              "-lssl",
              "-lcrypto",
              "-ljson-c"
            ],
            "cflags": [
              "-DLINUX_BUILD=1"
            ]
          }
        ],
        [
          "OS=='mac'",
          {
            "libraries": [
              "-lcurl",
              "-L/opt/local/lib",
              "-lssl",
              "-lcrypto"
            ],
            "include_dirs": [
              "/opt/local/include"
            ],
            "cflags": [
              "-DMACOS_BUILD=1",
              "-I/opt/local/include"
            ],
            "xcode_settings": {
              "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
              "CLANG_CXX_LIBRARY": "libc++",
              "MACOSX_DEPLOYMENT_TARGET": "10.15",
              "LIBRARY_SEARCH_PATHS": [
                "/opt/local/lib"
              ],
              "HEADER_SEARCH_PATHS": [
                "/opt/local/include"
              ]
            }
          }
        ],
        [
          "target_arch=='arm64'",
          {
            "cflags": [
              "-DARCH_ARM64=1"
            ]
          }
        ],
        [
          "target_arch=='x64'",
          {
            "cflags": [
              "-DARCH_X64=1"
            ]
          }
        ]
      ]
    }
  ]
}