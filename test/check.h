#pragma once

// The whole test harness. No framework, because the thing being tested is a
// handful of pure headers and a dependency would be larger than the code under
// it -- and because CI has to be able to run this with nothing but a compiler.
//
// A test registers itself at static-init time and the runner walks the list, so
// adding one is writing TEST(name) { ... } and nothing else.

#include <cstdio>
#include <cstring>
#include <vector>
#include <string>

namespace check
{
    struct Case
    {
        const char* name;
        void (*fn)();
    };

    inline std::vector<Case>& cases()
    {
        static std::vector<Case> v;
        return v;
    }

    inline std::vector<std::string>& failures()
    {
        static std::vector<std::string> v;
        return v;
    }

    struct Register
    {
        Register(const char* name, void (*fn)()) { cases().push_back({ name, fn }); }
    };

    inline void fail(const char* file, int line, const char* expr, const char* extra)
    {
        char buf[512];
        snprintf(buf, sizeof(buf), "%s:%d: %s%s%s", file, line, expr,
                 extra && *extra ? " -- " : "", extra ? extra : "");
        failures().push_back(buf);
    }

    inline int run()
    {
        size_t failed = 0;
        for (const auto& c : cases())
        {
            const size_t before = failures().size();
            c.fn();
            const size_t added = failures().size() - before;
            if (added == 0)
            {
                printf("  ok   %s\n", c.name);
            }
            else
            {
                ++failed;
                printf("  FAIL %s\n", c.name);
                for (size_t i = before; i < failures().size(); ++i)
                    printf("         %s\n", failures()[i].c_str());
            }
        }
        printf("\n%zu case(s), %zu failed\n", cases().size(), failed);
        return failed == 0 ? 0 : 1;
    }
}

#define TEST(name)                                                             \
    static void name();                                                        \
    static check::Register reg_##name(#name, &name);                           \
    static void name()

#define CHECK(expr)                                                            \
    do { if (!(expr)) check::fail(__FILE__, __LINE__, #expr, ""); } while (0)

#define CHECK_EQ(a, b)                                                         \
    do {                                                                       \
        const auto va_ = (a); const auto vb_ = (b);                            \
        if (!(va_ == vb_)) {                                                   \
            char extra_[128];                                                  \
            snprintf(extra_, sizeof(extra_), "got %lld, want %lld",            \
                     (long long)va_, (long long)vb_);                          \
            check::fail(__FILE__, __LINE__, #a " == " #b, extra_);             \
        }                                                                      \
    } while (0)
