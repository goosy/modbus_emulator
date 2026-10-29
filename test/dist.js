// Imported with node --test --import: the tests run against the bundle in dist
// (test/target.js). The variable reaches the processes of the test files, which
// inherit the environment.
process.env.MODBUS_EMULATOR_TEST_TARGET = "dist";
