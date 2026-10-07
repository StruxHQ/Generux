# Host tests. Not part of the firmware build -- ESP-IDF never sees this file.
#
# What belongs here is what names no layer: the pure headers under main/lib/ that
# compile against nothing but the standard library. Everything else in this
# project needs a radio, a flash partition or a socket, and stays verified by
# driving a real device over its own wire. That is a deliberate boundary, not a
# gap waiting to be filled with mocks of the device.
cmake_minimum_required(VERSION 3.16)
project(strux-host-tests CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

enable_testing()

add_executable(strux-host-tests
    main.cpp
    test_channel_protocol.cpp
    test_command_args.cpp
    test_console_args.cpp
    test_channel_table.cpp
    test_connection_state.cpp
)

target_include_directories(strux-host-tests PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_CURRENT_SOURCE_DIR}/../main/lib/protocol
)

if(MSVC)
    target_compile_options(strux-host-tests PRIVATE /W4 /WX)
else()
    target_compile_options(strux-host-tests PRIVATE -Wall -Wextra -Werror)
endif()

add_test(NAME host-tests COMMAND strux-host-tests)
