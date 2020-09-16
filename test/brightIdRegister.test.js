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

const getVerificationsSignature = (contextIds, timestamp) => {
  const hashedMessage = web3.utils.soliditySha3(
    BRIGHT_ID_CONTEXT,
    { type: 'address[]', value: contextIds },
    timestamp
  )
  const signingKey = new ethers.utils.SigningKey(VERIFICATIONS_PRIVATE_KEY)
  return signingKey.signDigest(hashedMessage)
}

contract('BrightIdRegister', ([appManager, verifier, verifier2, brightIdUser, brightIdUser2, brightIdUser3]) => {
  let dao, acl
  let brightIdRegsiterBase, brightIdRegister

  before(async () => {
    brightIdRegsiterBase = await BrightIdRegister.new()
  })

  beforeEach(async () => {
    ({ dao, acl } = await newDao(appManager))
    const brightIdRegisterProxyAddress = await newApp(dao, 'brightid-register', brightIdRegsiterBase.address, appManager)
    brightIdRegister = await BrightIdRegister.at(brightIdRegisterProxyAddress)
    await acl.createPermission(ANY_ADDRESS, brightIdRegister.address, await brightIdRegister.UPDATE_SETTINGS_ROLE(), appManager, { from: appManager })
  })

  context('initialize(brightIdContext, brightIdVerifier, registrationPeriod, verificationTimestampVariance)', () => {
    let addresses, timestamp, sig

    beforeEach(async () => {
      await brightIdRegister.initialize(BRIGHT_ID_CONTEXT, verifier, REGISTRATION_PERIOD, VERIFICATION_TIMESTAMP_VARIANCE)
      addresses = [brightIdUser]
      timestamp = await brightIdRegister.getTimestampPublic()
      sig = getVerificationsSignature(addresses, timestamp)
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
      const brightIdRegisterProxyAddress = await newApp(dao, 'brightid-register', brightIdRegsiterBase.address, appManager)
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
        assert.closeTo(registerTime.toNumber(), timestamp.toNumber(), 3, 'Incorrect register time')
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

    context('isVerified(brightIdUser)', () => {

      it('returns true when user verified within verification period', async () => {
        await brightIdRegister.register(BRIGHT_ID_CONTEXT, addresses, timestamp, sig.v, sig.r, sig.s, ZERO_ADDRESS, "0x0", { from: brightIdUser })

        const isVerified = await brightIdRegister.isVerified(brightIdUser)

        assert.isTrue(isVerified, "Incorrect is verified")
      })

      it('returns false when user verified and outside verification period', async () => {
        await brightIdRegister.register(BRIGHT_ID_CONTEXT, addresses, timestamp, sig.v, sig.r, sig.s, ZERO_ADDRESS, "0x0", { from: brightIdUser })
        await brightIdRegister.mockIncreaseTime(REGISTRATION_PERIOD)

        const isVerified = await brightIdRegister.isVerified(brightIdUser)

        assert.isFalse(isVerified, "Incorrect is verified")
      })

      it('returns false when address is void', async () => {
        await brightIdRegister.register(BRIGHT_ID_CONTEXT, addresses, timestamp, sig.v, sig.r, sig.s, ZERO_ADDRESS, "0x0", { from: brightIdUser })
        const newAddresses = [brightIdUser2, brightIdUser]
        const newSig = getVerificationsSignature(newAddresses, timestamp)
        await brightIdRegister.register(BRIGHT_ID_CONTEXT, newAddresses, timestamp, newSig.v, newSig.r, newSig.s, ZERO_ADDRESS, "0x0", { from: brightIdUser2 })

        const isVerified = await brightIdRegister.isVerified(brightIdUser)

        assert.isFalse(isVerified, "Incorrect is verified")
      })

      it('returns false when address not verified', async () => {
        const isVerified = await brightIdRegister.isVerified(brightIdUser)
        assert.isFalse(isVerified, "Incorrect is verified")
      })
    })

    context('uniqueUserId(brightIdUser)', async () => {

      it('reverts when no unique user id', async () => {
        await assertRevert(brightIdRegister.uniqueUserId(brightIdUser), "NO_UNIQUE_ID_ASSIGNED")
      })

      it('returns correct unique user id after registration', async () => {
        await brightIdRegister.register(BRIGHT_ID_CONTEXT, addresses, timestamp, sig.v, sig.r, sig.s, ZERO_ADDRESS, "0x0", { from: brightIdUser })

        const uniqueUserId = await brightIdRegister.uniqueUserId(brightIdUser)

        assert.equal(uniqueUserId, brightIdUser, "Incorrect unique user id")
      })

      it('returns correct unique user id after multiple registrations', async () => {
        await brightIdRegister.register(BRIGHT_ID_CONTEXT, addresses, timestamp, sig.v, sig.r, sig.s, ZERO_ADDRESS, "0x0", { from: brightIdUser })
        const newAddresses = [brightIdUser2, brightIdUser]
        const newSig = getVerificationsSignature(newAddresses, timestamp)
        await brightIdRegister.register(BRIGHT_ID_CONTEXT, newAddresses, timestamp, newSig.v, newSig.r, newSig.s, ZERO_ADDRESS, "0x0", { from: brightIdUser2 })

        const user1UniqueId = await brightIdRegister.uniqueUserId(brightIdUser)
        const user2UniqueId = await brightIdRegister.uniqueUserId(brightIdUser2)

        assert.equal(user1UniqueId, brightIdUser, "Incorrect user 1 unique id")
        assert.equal(user2UniqueId, brightIdUser, "Incorrect user 2 unique id")
      })

      it('returns correct unique user id after registration with 2 addresses', async () => {
        const newAddresses = [brightIdUser2, brightIdUser]
        const newSig = getVerificationsSignature(newAddresses, timestamp)
        await brightIdRegister.register(BRIGHT_ID_CONTEXT, newAddresses, timestamp, newSig.v, newSig.r, newSig.s, ZERO_ADDRESS, "0x0", { from: brightIdUser2 })

        const user2UniqueId = await brightIdRegister.uniqueUserId(brightIdUser2)

        await assertRevert(brightIdRegister.uniqueUserId(brightIdUser), "NO_UNIQUE_ID_ASSIGNED")
        assert.equal(user2UniqueId, brightIdUser, "Incorrect user 2 unique id")
      })
    })
  })
})
