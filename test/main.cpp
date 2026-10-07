#include "check.h"

int main()
{
    printf("strux host tests\n\n");

    // An empty run passes, which is the one way this job could go green while
    // checking nothing: cases register themselves at static-init time, so a
    // translation unit dropped from the build takes its cases with it and says
    // nothing about it. ctest would report a pass either way.
    if (check::cases().empty())
    {
        printf("no cases registered -- the test binary is not checking anything\n");
        return 2;
    }

    return check::run();
}
