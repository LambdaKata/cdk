# Tasks

## Task 1: Delete Legacy Licensing Files

- [ ] 1.1 Delete `src/licensing.ts` file
- [ ] 1.2 Delete `src/mock-licensing.ts` file
- [ ] 1.3 Delete `test/licensing.test.ts` file
- [ ] 1.4 Delete `test/mock-licensing.test.ts` file

## Task 2: Remove Internal Testing Interfaces from kata-wrapper.ts

- [ ] 2.1 Remove import of `createLicensingService, LicensingService` from `./licensing`
- [ ] 2.2 Delete the `KataWrapperInternalOptions` interface
- [ ] 2.3 Remove `licensingService` parameter handling from `kataWithAccountId` function
- [ ] 2.4 Remove `syncLicensingService` parameter handling from `performKataTransformationSync` function
- [ ] 2.5 Change `kataWithAccountId` props type from `KataWrapperInternalOptions` to `KataWrapperOptions`
- [ ] 2.6 Change `performKataTransformationSync` props type from `KataWrapperInternalOptions` to `KataWrapperOptions`

## Task 3: Update Public API Exports in index.ts

- [ ] 3.1 Remove `kataWithAccountId` from exports in `src/index.ts`
- [ ] 3.2 Verify `LicensingResponse` is still exported from `./types` (no change needed, just verify)

## Task 4: Refactor Tests to Use jest.mock

- [ ] 4.1 Update `test/kata-wrapper.test.ts` to use `jest.mock('@lambda-kata/licensing')` instead of `MockLicensingService`
- [ ] 4.2 Update `test/kata-wrapper.property.test.ts` to use `jest.mock('@lambda-kata/licensing')` instead of `MockLicensingService`
- [ ] 4.3 Update `test/region-resolution.test.ts` to use `jest.mock('@lambda-kata/licensing')` instead of `MockLicensingService`
- [ ] 4.4 Update `test/kata-sync-transformation.test.ts` to use `jest.mock('@lambda-kata/licensing')` pattern

## Task 5: Verify and Run Tests

- [ ] 5.1 Run `yarn lint` to verify no lint errors
- [ ] 5.2 Run `yarn test` to verify all tests pass
- [ ] 5.3 Run `yarn build` to verify build succeeds
