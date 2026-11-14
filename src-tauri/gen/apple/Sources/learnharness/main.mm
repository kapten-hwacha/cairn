#include "bindings/bindings.h"

extern "C" void lh_pencil_bootstrap(void);

int main(int argc, char * argv[]) {
	lh_pencil_bootstrap();
	ffi::start_app();
	return 0;
}
