const BrightIdRegister = artifacts.require('BrightIdRegisterMock.sol')
const RegisterAndCall = artifacts.require('RegisterAndCallMock.sol')
const RegisterAndCallAbi = require('../artifacts/RegisterAndCallMock.json').abi
const { assertRevert } = require('@aragon/contract-helpers-test/src/asserts/assertThrow')
const { ONE_DAY, ONE_WEEK, ZERO_ADDRESS, getEventArgument, getEvents } = require('@aragon/contract-helpers-test')
const { newDao, newApp } = require('./helpers/dao')
const ethers = require('ethers')

const ANY_ADDRESS = '0xffffffffffffffffffffffffffffffffffffffff'

// Use the private key of whatever the second account is in the local chain
// In this case it is 0xead9c93b79ae7c1591b1fb5323bd777e86e150d4 which is the third address in the buidlerevm node
const VERIFICATIONS_PRIVATE_KEY = '0xd49743deccbccc5dc7baa8e69e5be03298da8688a15dd202e20f15d5e0e9a9fb'
const BRIGHT_ID_CONTEXT = '0x3168697665000000000000000000000000000000000000000000000000000000' // stringToBytes32("1hive")
const REGISTRATION_PERIOD = ONE_WEEK
const VERIFICATION_TIMESTAMP_VARIANCE = ONE_DAY

contract('BrightIdRegister', ([appManager, verifier, verifier2, brightIdUser, brightIdUser2, brightIdUser3]) => {
  let dao, acl
  let brightIdRegsiterBase, brightIdRegister

  before(async () => {
    brightIdRegsiterBase = await BrightIdRegister.new()
  })

  beforeEach(async () => {
    ({ dao, acl } = await newDao(appManager))
    const brightIdRegisterProxyAddress = await newApp(dao, 'brightid-user-register', brightIdRegsiterBase.address, appManager)
    brightIdRegister = await BrightIdRegister.at(brightIdRegisterProxyAddress)
    await acl.createPermission(ANY_ADDRESS, brightIdRegister.address, await brightIdRegister.UPDATE_SETTINGS_ROLE(), appManager, { from: appManager })
  })

  context('initialize(brightIdContext, brightIdVerifier, registrationPeriod, verificationTimestampVariance)', () => {
    beforeEach(async () => {
      await brightIdRegister.initialize(BRIGHT_ID_CONTEXT, verifier, REGISTRATION_PERIOD, VERIFICATION_TIMESTAMP_VARIANCE)
    })

    it('should set init params correctly', async () => {
      const brightIdContext = await brightIdRegister.brightIdContext()
      const brightIdVerifier = await brightIdRegister.brightIdVerifier()
      const registrationPeriod = await brightIdRegister.registrationPeriod()
      const verificationTimestampVariance = await brightIdRegister.verificationTimestampVariance()

      assert.equal(brightIdContext, BRIGHT_ID_CONTEXT, 'Incorrect bright id context')
      assert.equal(brightIdVerifier, verifier, 'Incorrect bright id verifier')
      assert.equal(registrationPeriod, REGISTRATION_PERIOD, 'Incorrect registration period')
      assert.equal(verificationTimestampVariance, VERIFICATION_TIMESTAMP_VARIANCE, 'Incorrect verification timestamp variance')
    })

    it('reverts when registration period is 0', async () => {
      const brightIdRegisterProxyAddress = await newApp(dao, 'brightid-user-register', brightIdRegsiterBase.address, appManager)
      brightIdRegister = await BrightIdRegister.at(brightIdRegisterProxyAddress)
      await assertRevert(brightIdRegister.initialize(BRIGHT_ID_CONTEXT, verifier, 0, VERIFICATION_TIMESTAMP_VARIANCE),
        'REGISTRATION_PERIOD_ZERO')
    })

    context('setBrightIdVerifier(brightIdVerifier)', () => {
      it('sets the bright id verifier', async () => {
        await brightIdRegister.setBrightIdVerifier(verifier2)

        const brightIdVerifier = await brightIdRegister.brightIdVerifier()
        assert.equal(brightIdVerifier, verifier2, 'Incorrect bright id verifier')
      })

      it('reverts when no permission', async () => {
        await acl.revokePermission(ANY_ADDRESS, brightIdRegister.address, await brightIdRegister.UPDATE_SETTINGS_ROLE())
        await assertRevert(brightIdRegister.setBrightIdVerifier(verifier2), 'APP_AUTH_FAILED')
      })
    })

    context('setRegistrationPeriod(registrationPeriod)', () => {
      it('sets the registration period', async () => {
        const newRegistrationPeriod = ONE_DAY

        await brightIdRegister.setRegistrationPeriod(newRegistrationPeriod)

        const registrationPeriod = await brightIdRegister.registrationPeriod()
        assert.equal(registrationPeriod, newRegistrationPeriod, 'Incorrect registration period')
      })

      it('reverts when registration period is 0', async () => {
        await assertRevert(brightIdRegister.setRegistrationPeriod(0), 'REGISTRATION_PERIOD_ZERO')
      })

      it('reverts when no permission', async () => {
        await acl.revokePermission(ANY_ADDRESS, brightIdRegister.address, await brightIdRegister.UPDATE_SETTINGS_ROLE())
        await assertRevert(brightIdRegister.setRegistrationPeriod(ONE_DAY), 'APP_AUTH_FAILED')
      })
    })

    context('setVerificationTimestampVariance(verificationTimestampVariance)', () => {
      it('sets the verification timestamp variance', async () => {
        const newVerificationTimestampVariance = ONE_WEEK

        await brightIdRegister.setVerificationTimestampVariance(newVerificationTimestampVariance)

        const verificationTimestampVariance = await brightIdRegister.verificationTimestampVariance()
        assert.equal(verificationTimestampVariance, newVerificationTimestampVariance, 'Incorrect verification timestamp variance')
      })

      it('reverts when no permission', async () => {
        await acl.revokePermission(ANY_ADDRESS, brightIdRegister.address, await brightIdRegister.UPDATE_SETTINGS_ROLE())
        await assertRevert(brightIdRegister.setVerificationTimestampVariance(ONE_WEEK), 'APP_AUTH_FAILED')
      })
    })

    context('register(brightIdContext, addrs, timestamp, v, r, s, registerAndCall, functionCallData)', () => {
      let addresses, timestamp, sig

      const getVerificationsSignature = (contextIds, timestamp) => {
        const hashedMessage = web3.utils.soliditySha3(
          BRIGHT_ID_CONTEXT,
          { type: 'address[]', value: contextIds },
          timestamp
        )
        const signingKey = new ethers.utils.SigningKey(VERIFICATIONS_PRIVATE_KEY)
        return signingKey.signDigest(hashedMessage)
      }

      const assertCloseToBn = (actual, expected, delta, message) => {
        assert.closeTo(actual.toNumber(), expected.toNumber(), delta, message)
      }

      beforeEach(async () => {
        addresses = [brightIdUser]
        timestamp = await brightIdRegister.getTimestampPublic()
        sig = getVerificationsSignature(addresses, timestamp)
      })

      it('reverts when sender not first address in verification contextIds', async () => {
        await assertRevert(brightIdRegister.register(BRIGHT_ID_CONTEXT, addresses, timestamp, sig.v, sig.r, sig.s, ZERO_ADDRESS, "0x0", { from: brightIdUser2 }), 'SENDER_NOT_IN_VERIFICATION')
      })

      it('reverts when incorrect verification signature used', async () => {
        await assertRevert(brightIdRegister.register(BRIGHT_ID_CONTEXT, addresses, timestamp, sig.v - 1, sig.r, sig.s, ZERO_ADDRESS, "0x0", { from: brightIdUser }), 'INCORRECT_VERIFICATION')
      })

      it('reverts when verification timestamp too far in the past', async () => {
        const verificationTimestampVariance = await brightIdRegister.verificationTimestampVariance()
        await brightIdRegister.mockIncreaseTime(verificationTimestampVariance)
        await assertRevert(brightIdRegister.register(BRIGHT_ID_CONTEXT, addresses, timestamp, sig.v, sig.r, sig.s, ZERO_ADDRESS, "0x0", { from: brightIdUser }), 'INCORRECT_VERIFICATION')
      })

      it('reverts when voided address is used', async () => {
        const newAddresses = [brightIdUser2, brightIdUser]
        const newSig = getVerificationsSignature(newAddresses, timestamp)
        await brightIdRegister.register(BRIGHT_ID_CONTEXT, newAddresses, timestamp, newSig.v, newSig.r, newSig.s, ZERO_ADDRESS, "0x0", { from: brightIdUser2 })

        await assertRevert(brightIdRegister.register(BRIGHT_ID_CONTEXT, addresses, timestamp, sig.v, sig.r, sig.s, ZERO_ADDRESS, "0x0", { from: brightIdUser }),
          'ADDRESS_VOIDED')
      })

      it('registers user', async () => {
        await brightIdRegister.register(BRIGHT_ID_CONTEXT, addresses, timestamp, sig.v, sig.r, sig.s, ZERO_ADDRESS, "0x0", { from: brightIdUser })

        const { uniqueUserId, registerTime, addressVoid } = await brightIdRegister.userRegistrations(brightIdUser)
        assert.equal(uniqueUserId, brightIdUser, 'Incorrect unique id')
        assertCloseToBn(registerTime, timestamp, 3, 'Incorrect register time')
        assert.isFalse(addressVoid, 'Incorrect address void')
      })

      it('does not update unique user id when registering with a new account', async () => {
        await brightIdRegister.register(BRIGHT_ID_CONTEXT, addresses, timestamp, sig.v, sig.r, sig.s, ZERO_ADDRESS, "0x0", { from: brightIdUser })
        addresses = [brightIdUser2, brightIdUser]
        sig = getVerificationsSignature(addresses, timestamp)

        await brightIdRegister.register(BRIGHT_ID_CONTEXT, addresses, timestamp, sig.v, sig.r, sig.s, ZERO_ADDRESS, "0x0", { from: brightIdUser2 })

        const { uniqueUserId } = await brightIdRegister.userRegistrations(brightIdUser)
        assert.equal(uniqueUserId, brightIdUser, 'Incorrect unique id')
      })

      it('voids all previously registered or unregistered accounts', async () => {
        addresses = [brightIdUser2, brightIdUser]
        sig = getVerificationsSignature(addresses, timestamp)
        await brightIdRegister.register(BRIGHT_ID_CONTEXT, addresses, timestamp, sig.v, sig.r, sig.s, ZERO_ADDRESS, "0x0", { from: brightIdUser2 })

        const { addressVoid: originalAddressVoid } = await brightIdRegister.userRegistrations(brightIdUser)
        const { addressVoid: newAddressVoid } = await brightIdRegister.userRegistrations(brightIdUser2)
        assert.isTrue(originalAddressVoid, 'Incorrect original address void')
        assert.isFalse(newAddressVoid, 'Incorrect new address void')
      })

      it('voids all previously registered accounts when already voided accounts', async () => {
        addresses = [brightIdUser2, brightIdUser]
        sig = getVerificationsSignature(addresses, timestamp)
        await brightIdRegister.register(BRIGHT_ID_CONTEXT, addresses, timestamp, sig.v, sig.r, sig.s, ZERO_ADDRESS, "0x0", { from: brightIdUser2 })
        addresses = [brightIdUser3, brightIdUser2, brightIdUser]
        sig = getVerificationsSignature(addresses, timestamp)

        await brightIdRegister.register(BRIGHT_ID_CONTEXT, addresses, timestamp, sig.v, sig.r, sig.s, ZERO_ADDRESS, "0x0", { from: brightIdUser3 })

        const { addressVoid: originalAddressVoid } = await brightIdRegister.userRegistrations(brightIdUser)
        const { addressVoid: secondAddressVoid } = await brightIdRegister.userRegistrations(brightIdUser2)
        const { addressVoid: thirdAddressVoid } = await brightIdRegister.userRegistrations(brightIdUser3)
        assert.isTrue(originalAddressVoid, 'Incorrect original address void')
        assert.isTrue(secondAddressVoid, 'Incorrect second address void')
        assert.isFalse(thirdAddressVoid, 'Incorrect third address void')
      })

      it('calls external function when specified', async () => {
        const expectedBytesSent = "0xabcd";
        const registerAndCall = await RegisterAndCall.new()

        const registerReceipt = await brightIdRegister.register(BRIGHT_ID_CONTEXT, addresses, timestamp, sig.v, sig.r, sig.s, registerAndCall.address, expectedBytesSent, { from: brightIdUser })

        const userUniqueId = getEventArgument(registerReceipt, "ReceiveRegistration", "usersUniqueId",  { decodeForAbi: RegisterAndCallAbi })
        const actualBytesSent = getEventArgument(registerReceipt, "ReceiveRegistration", "data",  { decodeForAbi: RegisterAndCallAbi })
        assert.equal(userUniqueId, brightIdUser.toLowerCase(), "Incorrect unique user id")
        assert.equal(actualBytesSent, expectedBytesSent, "Incorrect data")
      })

      it('does not call external function when address is 0x0', async () => {
        const registerReceipt = await brightIdRegister.register(BRIGHT_ID_CONTEXT, addresses, timestamp, sig.v, sig.r, sig.s, ZERO_ADDRESS, "0x0", { from: brightIdUser })
        assert.deepEqual(getEvents(registerReceipt, "ReceiveRegistration", { decodeForAbi: RegisterAndCallAbi }), [], "Incorrect event fired")
      })
    })
  })

  // it('should be incremented by any address', async () => {
  //   await brightIdRegister.increment(1, { from: user })
  //   assert.equal(await brightIdRegister.value(), INIT_VALUE + 1)
  // })
  //
  // it('should not be decremented beyond 0', async () => {
  //   await assertRevert(brightIdRegister.decrement(INIT_VALUE + 1))
  // })
})
