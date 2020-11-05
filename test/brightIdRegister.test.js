const BrightIdRegister = artifacts.require('BrightIdRegisterMock.sol')
const RegisterAndCall = artifacts.require('RegisterAndCallMock.sol')
const RegisterAndCallAbi = require('../artifacts/RegisterAndCallMock.json').abi
const { assertRevert } = require('@aragon/contract-helpers-test/src/asserts/assertThrow')
const { ONE_DAY, ONE_WEEK, ZERO_ADDRESS, getEventArgument, getEvents, bn } = require('@aragon/contract-helpers-test')
const { newDao, newApp } = require('./helpers/dao')
const ethers = require('ethers')

const ANY_ADDRESS = '0xffffffffffffffffffffffffffffffffffffffff'

// Use the private keys of whatever the second and third accounts are in the local chain. In this case it is
// 0xead9c93b79ae7c1591b1fb5323bd777e86e150d4, 0xe5904695748fe4a84b40b3fc79de2277660bd1d3,
// 0x92561f28ec438ee9831d00d1d59fbdc981b762b2 which is the second and third address in the buidlerevm node
// (can check with `npx buidler node`)
const VERIFICATIONS_PRIVATE_KEYS = [
  '0xd49743deccbccc5dc7baa8e69e5be03298da8688a15dd202e20f15d5e0e9a9fb',
  '0x23c601ae397441f3ef6f1075dcb0031ff17fb079837beadaf3c84d96c6f3e569',
  '0xee9d129c1997549ee09c0757af5939b2483d80ad649a0eda68e8b0357ad11131'
]
const BRIGHT_ID_CONTEXT = '0x3168697665000000000000000000000000000000000000000000000000000000' // stringToBytes32("1hive")
const REGISTRATION_PERIOD = ONE_WEEK
const VERIFICATION_TIMESTAMP_VARIANCE = ONE_DAY

const getVerificationsSignature = (contextIds, timestamp, privateKey) => {
  const hashedMessage = web3.utils.soliditySha3(
    BRIGHT_ID_CONTEXT,
    { type: 'address[]', value: contextIds },
    timestamp
  )
  const signingKey = new ethers.utils.SigningKey(privateKey)
  const digest = signingKey.signDigest(hashedMessage)
  return { v: [digest.v], r: [digest.r], s: [digest.s] }
}

const getVerificationsSignatures = (contextIds, timestamps) => {
  const verifier1Sig = getVerificationsSignature(contextIds, timestamps[0], VERIFICATIONS_PRIVATE_KEYS[0])
  const verifier2Sig = getVerificationsSignature(contextIds, timestamps[1], VERIFICATIONS_PRIVATE_KEYS[1])
  return { v: [...verifier1Sig.v, ...verifier2Sig.v], r: [...verifier1Sig.r, ...verifier2Sig.r], s: [...verifier1Sig.s, ...verifier2Sig.s]}
}

const getFirstAndThirdVerificationsSignatures = (contextIds, timestamps) => {
  const verifier1Sig = getVerificationsSignature(contextIds, timestamps[0], VERIFICATIONS_PRIVATE_KEYS[0])
  const verifier3Sig = getVerificationsSignature(contextIds, timestamps[1], VERIFICATIONS_PRIVATE_KEYS[2])
  return { v: [...verifier1Sig.v, ...verifier3Sig.v], r: [...verifier1Sig.r, ...verifier3Sig.r], s: [...verifier1Sig.s, ...verifier3Sig.s]}
}

contract('BrightIdRegister', ([appManager, verifier, verifier2, verifier3, brightIdUser, brightIdUser2, brightIdUser3]) => {
  let dao, acl
  let brightIdRegisterBase, brightIdRegister

  before(async () => {
    brightIdRegisterBase = await BrightIdRegister.new()
  })

  beforeEach(async () => {
    ({ dao, acl } = await newDao(appManager))
    const brightIdRegisterProxyAddress = await newApp(dao, 'brightid-register', brightIdRegisterBase.address, appManager)
    brightIdRegister = await BrightIdRegister.at(brightIdRegisterProxyAddress)
    await acl.createPermission(ANY_ADDRESS, brightIdRegister.address, await brightIdRegister.UPDATE_SETTINGS_ROLE(), appManager, { from: appManager })
  })

  context('initialize(brightIdContext, brightIdVerifiers, requiredVerifications, registrationPeriod, verificationTimestampVariance)', () => {
    let addresses, timestamp, timestamps, signatures

    beforeEach(async () => {
      await brightIdRegister.initialize(BRIGHT_ID_CONTEXT, [verifier, verifier2], bn(2), REGISTRATION_PERIOD, VERIFICATION_TIMESTAMP_VARIANCE)
      addresses = [brightIdUser]
      timestamp = await brightIdRegister.getTimestampPublic()
      timestamps = [timestamp, timestamp.add(bn(1))]
      signatures = getVerificationsSignatures(addresses, timestamps)
    })

    it('should set init params correctly', async () => {
      const brightIdContext = await brightIdRegister.brightIdContext()
      const brightIdVerifiers = await brightIdRegister.getBrightIdVerifiers()
      const registrationPeriod = await brightIdRegister.registrationPeriod()
      const verificationTimestampVariance = await brightIdRegister.verificationTimestampVariance()

      assert.equal(brightIdContext, BRIGHT_ID_CONTEXT, 'Incorrect bright id context')
      assert.deepEqual(brightIdVerifiers, [verifier, verifier2], 'Incorrect bright id verifier')
      assert.equal(registrationPeriod, REGISTRATION_PERIOD, 'Incorrect registration period')
      assert.equal(verificationTimestampVariance, VERIFICATION_TIMESTAMP_VARIANCE, 'Incorrect verification timestamps variance')
    })

    it('reverts when registration period is 0', async () => {
      const brightIdRegisterProxyAddress = await newApp(dao, 'brightid-register', brightIdRegisterBase.address, appManager)
      brightIdRegister = await BrightIdRegister.at(brightIdRegisterProxyAddress)
      await assertRevert(brightIdRegister.initialize(BRIGHT_ID_CONTEXT, [verifier], bn(1), 0, VERIFICATION_TIMESTAMP_VARIANCE),
        'BRIGHTID_REGISTRATION_PERIOD_ZERO')
    })

    it('reverts when empty brightid verifiers', async () => {
      const brightIdRegisterProxyAddress = await newApp(dao, 'brightid-register', brightIdRegisterBase.address, appManager)
      brightIdRegister = await BrightIdRegister.at(brightIdRegisterProxyAddress)
      await assertRevert(brightIdRegister.initialize(BRIGHT_ID_CONTEXT, [], bn(0), REGISTRATION_PERIOD, VERIFICATION_TIMESTAMP_VARIANCE),
        'BRIGHTID_NO_VERIFIERS')
    })

    it('reverts when more brightid verifiers than max', async () => {
      const brightIdRegisterProxyAddress = await newApp(dao, 'brightid-register', brightIdRegisterBase.address, appManager)
      brightIdRegister = await BrightIdRegister.at(brightIdRegisterProxyAddress)
      const maxBrightIdVerifiers = await brightIdRegister.MAX_BRIGHTID_VERIFIERS()
      let brightIdVerifiers = [verifier]
      for (let i = 0; i < maxBrightIdVerifiers; i++) {
        brightIdVerifiers.push(verifier)
      }
      await assertRevert(brightIdRegister.initialize(BRIGHT_ID_CONTEXT, brightIdVerifiers, bn(maxBrightIdVerifiers), REGISTRATION_PERIOD, VERIFICATION_TIMESTAMP_VARIANCE),
        'BRIGHTID_TOO_MANY_VERIFIERS')
    })

    it('reverts when required verifiers is zero', async () => {
      const brightIdRegisterProxyAddress = await newApp(dao, 'brightid-register', brightIdRegisterBase.address, appManager)
      brightIdRegister = await BrightIdRegister.at(brightIdRegisterProxyAddress)
      await assertRevert(brightIdRegister.initialize(BRIGHT_ID_CONTEXT, [verifier], bn(0), REGISTRATION_PERIOD, VERIFICATION_TIMESTAMP_VARIANCE),
        'BRIGHTID_NOT_ENOUGH_VERIFICATIONS')
    })

    it('reverts when required verifiers is more than given verifiers', async () => {
      const brightIdRegisterProxyAddress = await newApp(dao, 'brightid-register', brightIdRegisterBase.address, appManager)
      brightIdRegister = await BrightIdRegister.at(brightIdRegisterProxyAddress)
      await assertRevert(brightIdRegister.initialize(BRIGHT_ID_CONTEXT, [verifier], bn(2), REGISTRATION_PERIOD, VERIFICATION_TIMESTAMP_VARIANCE),
        'BRIGHTID_TOO_MANY_VERIFICATIONS')
    })

    context('setBrightIdVerifiers(brightIdVerifier, requiredVerifications)', () => {
      it('sets the bright id verifier', async () => {
        await brightIdRegister.setBrightIdVerifiers([verifier2], 1)

        const brightIdVerifiers = await brightIdRegister.getBrightIdVerifiers()
        assert.deepEqual(brightIdVerifiers, [verifier2], 'Incorrect bright id verifier')
      })

      context('register(brightIdContext, addrs, timestamps, v, r, s, registerAndCall, functionCallData)', () => {
        it('registers user', async () => {
          const signature = getVerificationsSignature(addresses, timestamp, VERIFICATIONS_PRIVATE_KEYS[1])
          await brightIdRegister.setBrightIdVerifiers([verifier2], bn(1))

          await brightIdRegister.register(addresses, [timestamp], signature.v, signature.r, signature.s, ZERO_ADDRESS, '0x0', { from: brightIdUser })

          const { uniqueUserId, registerTime, addressVoid } = await brightIdRegister.userRegistrations(brightIdUser)
          assert.equal(uniqueUserId, brightIdUser, 'Incorrect unique id')
          assert.closeTo(registerTime.toNumber(), timestamp.toNumber(), 3, 'Incorrect register time')
          assert.isFalse(addressVoid, 'Incorrect address void')
        })
      })

      it('reverts when setting to empty list', async () => {
        await assertRevert(brightIdRegister.setBrightIdVerifiers([], bn(0)), 'BRIGHTID_NO_VERIFIERS')
      })

      it('reverts when more brightid verifiers than max', async () => {
        const maxBrightIdVerifiers = await brightIdRegister.MAX_BRIGHTID_VERIFIERS()
        let brightIdVerifiers = [verifier]
        for (let i = 0; i < maxBrightIdVerifiers; i++) {
          brightIdVerifiers.push(verifier)
        }
        await assertRevert(brightIdRegister.setBrightIdVerifiers(brightIdVerifiers, bn(maxBrightIdVerifiers)),
          'BRIGHTID_TOO_MANY_VERIFIERS')
      })

      it('reverts when required verifiations is zero', async () => {
        await assertRevert(brightIdRegister.setBrightIdVerifiers([verifier], bn(0)),
          'BRIGHTID_NOT_ENOUGH_VERIFICATIONS')
      })

      it('reverts when required verifications is more than given verifiers', async () => {
        await assertRevert(brightIdRegister.setBrightIdVerifiers([verifier], bn(2)),
          'BRIGHTID_TOO_MANY_VERIFICATIONS')
      })

      it('reverts when no permission', async () => {
        await acl.revokePermission(ANY_ADDRESS, brightIdRegister.address, await brightIdRegister.UPDATE_SETTINGS_ROLE())
        await assertRevert(brightIdRegister.setBrightIdVerifiers([verifier2], bn(1)), 'APP_AUTH_FAILED')
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
        await assertRevert(brightIdRegister.setRegistrationPeriod(0), 'BRIGHTID_REGISTRATION_PERIOD_ZERO')
      })

      it('reverts when no permission', async () => {
        await acl.revokePermission(ANY_ADDRESS, brightIdRegister.address, await brightIdRegister.UPDATE_SETTINGS_ROLE())
        await assertRevert(brightIdRegister.setRegistrationPeriod(ONE_DAY), 'APP_AUTH_FAILED')
      })
    })

    context('setVerificationTimestampVariance(verificationTimestampVariance)', () => {
      it('sets the verification timestamps variance', async () => {
        const newVerificationTimestampVariance = ONE_WEEK

        await brightIdRegister.setVerificationTimestampVariance(newVerificationTimestampVariance)

        const verificationTimestampVariance = await brightIdRegister.verificationTimestampVariance()
        assert.equal(verificationTimestampVariance, newVerificationTimestampVariance, 'Incorrect verification timestamps variance')
      })

      it('reverts when no permission', async () => {
        await acl.revokePermission(ANY_ADDRESS, brightIdRegister.address, await brightIdRegister.UPDATE_SETTINGS_ROLE())
        await assertRevert(brightIdRegister.setVerificationTimestampVariance(ONE_WEEK), 'APP_AUTH_FAILED')
      })
    })

    context('register(brightIdContext, addrs, timestamps, v, r, s, registerAndCall, functionCallData)', () => {

      it('reverts when sender not first address in verification contextIds', async () => {
        await assertRevert(brightIdRegister.register(addresses, timestamps, signatures.v, signatures.r,
          signatures.s, ZERO_ADDRESS, '0x0', { from: brightIdUser2 }), 'BRIGHTID_SENDER_NOT_IN_VERIFICATION')
      })

      it('reverts when not enough timestamps', async () => {
        await assertRevert(brightIdRegister.register(addresses, [timestamp], signatures.v,
          signatures.r, signatures.s, ZERO_ADDRESS, '0x0', { from: brightIdUser }), 'BRIGHTID_INCORRECT_TIMESTAMPS')
      })

      it('reverts when not enough signatures', async () => {
        await assertRevert(brightIdRegister.register(addresses, timestamps, [signatures.v[0]],
          signatures.r, signatures.s, ZERO_ADDRESS, '0x0', { from: brightIdUser }), 'BRIGHTID_INCORRECT_SIGNATURES')
      })

      it('reverts when sigantures different lengths', async () => {
        await assertRevert(brightIdRegister.register(addresses, [...timestamps, timestamps[0]], signatures.v,
          signatures.r, signatures.s, ZERO_ADDRESS, '0x0', { from: brightIdUser }), 'BRIGHTID_SIGNATURES_DIFFERENT_LENGTHS')

        await assertRevert(brightIdRegister.register(addresses, timestamps, [...signatures.v, signatures.v[0]],
          signatures.r, signatures.s, ZERO_ADDRESS, '0x0', { from: brightIdUser }), 'BRIGHTID_SIGNATURES_DIFFERENT_LENGTHS')

        await assertRevert(brightIdRegister.register(addresses, timestamps, signatures.v,
          [...signatures.r, signatures.r[0]], signatures.s, ZERO_ADDRESS, '0x0', { from: brightIdUser }), 'BRIGHTID_SIGNATURES_DIFFERENT_LENGTHS')

        await assertRevert(brightIdRegister.register(addresses, timestamps, signatures.v,
          signatures.r, [...signatures.s, signatures.s[0]], ZERO_ADDRESS, '0x0', { from: brightIdUser }), 'BRIGHTID_SIGNATURES_DIFFERENT_LENGTHS')
      })

      it('reverts when incorrect verification signature used', async () => {
        await assertRevert(brightIdRegister.register(addresses, timestamps, [signatures.v[0] - 1, signatures.v[1]],
          signatures.r, signatures.s, ZERO_ADDRESS, '0x0', { from: brightIdUser }), 'BRIGHTID_NOT_VERIFIED')
      })

      it('reverts when same verification is used twice', async () => {
        const verifier1Sig = getVerificationsSignature(addresses, timestamps[0], VERIFICATIONS_PRIVATE_KEYS[0])
        const v = [...verifier1Sig.v, ...verifier1Sig.v]
        const r = [...verifier1Sig.r, ...verifier1Sig.r]
        const s = [...verifier1Sig.s, ...verifier1Sig.s]
        await assertRevert(brightIdRegister.register(addresses, timestamps, v, r, s, ZERO_ADDRESS, '0x0',
          { from: brightIdUser }), 'BRIGHTID_NOT_VERIFIED')
      })

      it('reverts when verification timestamp too far in the past', async () => {
        const verificationTimestampVariance = await brightIdRegister.verificationTimestampVariance()
        await brightIdRegister.mockIncreaseTime(verificationTimestampVariance)
        await assertRevert(brightIdRegister.register(addresses, timestamps, signatures.v, signatures.r,
          signatures.s, ZERO_ADDRESS, '0x0', { from: brightIdUser }), 'BRIGHTID_NOT_VERIFIED')
      })

      it('reverts when voided address is used', async () => {
        const newAddresses = [brightIdUser2, brightIdUser]
        const newSig = getVerificationsSignatures(newAddresses, timestamps)
        await brightIdRegister.register(newAddresses, timestamps, newSig.v, newSig.r, newSig.s, ZERO_ADDRESS, '0x0', { from: brightIdUser2 })

        await assertRevert(brightIdRegister.register(addresses, timestamps, signatures.v, signatures.r, signatures.s, ZERO_ADDRESS, '0x0', { from: brightIdUser }),
          'BRIGHTID_ADDRESS_VOIDED')
      })

      it('registers user', async () => {
        await brightIdRegister.register(addresses, timestamps, signatures.v, signatures.r, signatures.s, ZERO_ADDRESS, '0x0', { from: brightIdUser })

        const { uniqueUserId, registerTime, addressVoid } = await brightIdRegister.userRegistrations(brightIdUser)
        assert.equal(uniqueUserId, brightIdUser, 'Incorrect unique id')
        assert.closeTo(registerTime.toNumber(), timestamp.toNumber(), 3, 'Incorrect register time')
        assert.isFalse(addressVoid, 'Incorrect address void')
      })

      it('registers user when verifications are in different order', async () => {
        const verifier1Sig = getVerificationsSignature(addresses, timestamps[0], VERIFICATIONS_PRIVATE_KEYS[0])
        const verifier2Sig = getVerificationsSignature(addresses, timestamps[1], VERIFICATIONS_PRIVATE_KEYS[1])
        signatures = { v: [...verifier2Sig.v, ...verifier1Sig.v], r: [...verifier2Sig.r, ...verifier1Sig.r], s: [...verifier2Sig.s, ...verifier1Sig.s]}

        await brightIdRegister.register(addresses, [timestamps[1], timestamps[0]], signatures.v, signatures.r, signatures.s, ZERO_ADDRESS, '0x0', { from: brightIdUser })

        const { uniqueUserId, registerTime, addressVoid } = await brightIdRegister.userRegistrations(brightIdUser)
        assert.equal(uniqueUserId, brightIdUser, 'Incorrect unique id')
        assert.closeTo(registerTime.toNumber(), timestamp.toNumber(), 3, 'Incorrect register time')
        assert.isFalse(addressVoid, 'Incorrect address void')
      })

      it('does not update unique user id when registering with a new account', async () => {
        await brightIdRegister.register(addresses, timestamps, signatures.v, signatures.r, signatures.s, ZERO_ADDRESS, '0x0', { from: brightIdUser })
        addresses = [brightIdUser2, brightIdUser]
        signatures = getVerificationsSignatures(addresses, timestamps)

        await brightIdRegister.register(addresses, timestamps, signatures.v, signatures.r, signatures.s, ZERO_ADDRESS, '0x0', { from: brightIdUser2 })

        const { uniqueUserId } = await brightIdRegister.userRegistrations(brightIdUser)
        assert.equal(uniqueUserId, brightIdUser, 'Incorrect unique id')
      })

      it('voids all previously registered or unregistered accounts', async () => {
        addresses = [brightIdUser2, brightIdUser]
        signatures = getVerificationsSignatures(addresses, timestamps)
        await brightIdRegister.register(addresses, timestamps, signatures.v, signatures.r, signatures.s, ZERO_ADDRESS, '0x0', { from: brightIdUser2 })

        const { addressVoid: originalAddressVoid } = await brightIdRegister.userRegistrations(brightIdUser)
        const { addressVoid: newAddressVoid } = await brightIdRegister.userRegistrations(brightIdUser2)
        assert.isTrue(originalAddressVoid, 'Incorrect original address void')
        assert.isFalse(newAddressVoid, 'Incorrect new address void')
      })

      it('voids all previously registered accounts when already voided accounts', async () => {
        addresses = [brightIdUser2, brightIdUser]
        signatures = getVerificationsSignatures(addresses, timestamps)
        await brightIdRegister.register(addresses, timestamps, signatures.v, signatures.r, signatures.s, ZERO_ADDRESS, '0x0', { from: brightIdUser2 })
        addresses = [brightIdUser3, brightIdUser2, brightIdUser]
        signatures = getVerificationsSignatures(addresses, timestamps)

        await brightIdRegister.register(addresses, timestamps, signatures.v, signatures.r, signatures.s, ZERO_ADDRESS, '0x0', { from: brightIdUser3 })

        const { addressVoid: originalAddressVoid } = await brightIdRegister.userRegistrations(brightIdUser)
        const { addressVoid: secondAddressVoid } = await brightIdRegister.userRegistrations(brightIdUser2)
        const { addressVoid: thirdAddressVoid } = await brightIdRegister.userRegistrations(brightIdUser3)
        assert.isTrue(originalAddressVoid, 'Incorrect original address void')
        assert.isTrue(secondAddressVoid, 'Incorrect second address void')
        assert.isFalse(thirdAddressVoid, 'Incorrect third address void')
      })

      it('calls external function when specified', async () => {
        const expectedBytesSent = '0xabcd'
        const registerAndCall = await RegisterAndCall.new()

        const registerReceipt = await brightIdRegister.register(addresses, timestamps, signatures.v, signatures.r, signatures.s, registerAndCall.address, expectedBytesSent, { from: brightIdUser })

        const userSenderAddress = getEventArgument(registerReceipt, 'ReceiveRegistration', 'usersSenderAddress', { decodeForAbi: RegisterAndCallAbi })
        const userUniqueId = getEventArgument(registerReceipt, 'ReceiveRegistration', 'usersUniqueId', { decodeForAbi: RegisterAndCallAbi })
        const actualBytesSent = getEventArgument(registerReceipt, 'ReceiveRegistration', 'data', { decodeForAbi: RegisterAndCallAbi })
        assert.equal(userSenderAddress, brightIdUser.toLowerCase(), 'Incorrect sender address')
        assert.equal(userUniqueId, brightIdUser.toLowerCase(), 'Incorrect unique user id')
        assert.equal(actualBytesSent, expectedBytesSent, 'Incorrect data')
      })

      it('does not call external function when address is 0x0', async () => {
        const registerReceipt = await brightIdRegister.register(addresses, timestamps, signatures.v, signatures.r, signatures.s, ZERO_ADDRESS, '0x0', { from: brightIdUser })
        assert.deepEqual(getEvents(registerReceipt, 'ReceiveRegistration', { decodeForAbi: RegisterAndCallAbi }), [], 'Incorrect event fired')
      })

      context('when requiring 2 out of 3 verifications', async () => {
        beforeEach(async () =>{
          await brightIdRegister.setBrightIdVerifiers([verifier, verifier2, verifier3], 2)
        })

        it('registers user when using first and third verifications signatures', async () => {
          signatures = getFirstAndThirdVerificationsSignatures(addresses, timestamps)
          await brightIdRegister.register(addresses, timestamps, signatures.v, signatures.r, signatures.s, ZERO_ADDRESS, '0x0', { from: brightIdUser })

          const { uniqueUserId, registerTime, addressVoid } = await brightIdRegister.userRegistrations(brightIdUser)
          assert.equal(uniqueUserId, brightIdUser, 'Incorrect unique id')
          assert.closeTo(registerTime.toNumber(), timestamp.toNumber(), 3, 'Incorrect register time')
          assert.isFalse(addressVoid, 'Incorrect address void')
        })

        it('registers user when using all 3 verifiers signatures', async () => {
          const verifier1Sig = getVerificationsSignature(addresses, timestamps[0], VERIFICATIONS_PRIVATE_KEYS[0])
          const verifier2Sig = getVerificationsSignature(addresses, timestamps[1], VERIFICATIONS_PRIVATE_KEYS[1])
          const verifier3Sig = getVerificationsSignature(addresses, timestamps[1], VERIFICATIONS_PRIVATE_KEYS[2])
          signatures = { v: [...verifier1Sig.v, ...verifier2Sig.v, ...verifier3Sig.v],
            r: [...verifier1Sig.r, ...verifier2Sig.r, ...verifier3Sig.r],
            s: [...verifier1Sig.s, ...verifier2Sig.s, ...verifier3Sig.s]}

          await brightIdRegister.register(addresses, [...timestamps, timestamps[1]], signatures.v, signatures.r, signatures.s, ZERO_ADDRESS, '0x0', { from: brightIdUser })

          const { uniqueUserId, registerTime, addressVoid } = await brightIdRegister.userRegistrations(brightIdUser)
          assert.equal(uniqueUserId, brightIdUser, 'Incorrect unique id')
          assert.closeTo(registerTime.toNumber(), timestamp.toNumber(), 3, 'Incorrect register time')
          assert.isFalse(addressVoid, 'Incorrect address void')
        })

        it('registers user when using all 3 verifiers signatures but one is wrong', async () => {
          const verifier1Sig = getVerificationsSignature(addresses, timestamps[0], VERIFICATIONS_PRIVATE_KEYS[0])
          const verifier2Sig = getVerificationsSignature(addresses, timestamps[1], VERIFICATIONS_PRIVATE_KEYS[1])
          const verifier3Sig = getVerificationsSignature(addresses, timestamps[1], VERIFICATIONS_PRIVATE_KEYS[2])
          signatures = { v: [verifier1Sig.v[0] - 1, ...verifier2Sig.v, ...verifier3Sig.v],
            r: [...verifier1Sig.r, ...verifier2Sig.r, ...verifier3Sig.r],
            s: [...verifier1Sig.s, ...verifier2Sig.s, ...verifier3Sig.s]}

          await brightIdRegister.register(addresses, [...timestamps, timestamps[1]], signatures.v, signatures.r, signatures.s, ZERO_ADDRESS, '0x0', { from: brightIdUser })

          const { uniqueUserId, registerTime, addressVoid } = await brightIdRegister.userRegistrations(brightIdUser)
          assert.equal(uniqueUserId, brightIdUser, 'Incorrect unique id')
          assert.closeTo(registerTime.toNumber(), timestamp.toNumber(), 3, 'Incorrect register time')
          assert.isFalse(addressVoid, 'Incorrect address void')
        })

        it('reverts when using all 3 verifiers signatures but two are wrong', async () => {
          const verifier1Sig = getVerificationsSignature(addresses, timestamps[0], VERIFICATIONS_PRIVATE_KEYS[0])
          const verifier2Sig = getVerificationsSignature(addresses, timestamps[1], VERIFICATIONS_PRIVATE_KEYS[1])
          const verifier3Sig = getVerificationsSignature(addresses, timestamps[1], VERIFICATIONS_PRIVATE_KEYS[2])
          signatures = { v: [verifier1Sig.v[0] - 1, verifier2Sig.v[0] - 1, ...verifier3Sig.v],
            r: [...verifier1Sig.r, ...verifier2Sig.r, ...verifier3Sig.r],
            s: [...verifier1Sig.s, ...verifier2Sig.s, ...verifier3Sig.s]}

          await assertRevert(brightIdRegister.register(addresses, [...timestamps, timestamps[1]], signatures.v, signatures.r, signatures.s, ZERO_ADDRESS, '0x0', { from: brightIdUser }),
            'BRIGHTID_NOT_VERIFIED')
        })

        it('reverts when using 3 verifiers signatures but one is wrong and two are the same', async () => {
          const verifier1Sig = getVerificationsSignature(addresses, timestamps[0], VERIFICATIONS_PRIVATE_KEYS[0])
          const verifier3Sig = getVerificationsSignature(addresses, timestamps[1], VERIFICATIONS_PRIVATE_KEYS[2])
          signatures = { v: [...verifier1Sig.v, ...verifier1Sig.v, verifier3Sig.v[0] - 1],
            r: [...verifier1Sig.r, ...verifier1Sig.r, ...verifier3Sig.r],
            s: [...verifier1Sig.s, ...verifier1Sig.s, ...verifier3Sig.s]}

          await assertRevert(brightIdRegister.register(addresses, [...timestamps, timestamps[1]], signatures.v, signatures.r, signatures.s, ZERO_ADDRESS, '0x0', { from: brightIdUser }),
            'BRIGHTID_NOT_VERIFIED')
        })
      })
    })

    context('isVerified(brightIdUser)', () => {

      it('returns true when user verified within verification period', async () => {
        await brightIdRegister.register(addresses, timestamps, signatures.v, signatures.r, signatures.s, ZERO_ADDRESS, '0x0', { from: brightIdUser })

        const isVerified = await brightIdRegister.isVerified(brightIdUser)

        assert.isTrue(isVerified, 'Incorrect is verified')
      })

      it('returns false when user verified and outside verification period', async () => {
        await brightIdRegister.register(addresses, timestamps, signatures.v, signatures.r, signatures.s, ZERO_ADDRESS, '0x0', { from: brightIdUser })
        await brightIdRegister.mockIncreaseTime(REGISTRATION_PERIOD)

        const isVerified = await brightIdRegister.isVerified(brightIdUser)

        assert.isFalse(isVerified, 'Incorrect is verified')
      })

      it('returns false when address is void', async () => {
        await brightIdRegister.register(addresses, timestamps, signatures.v, signatures.r, signatures.s, ZERO_ADDRESS, '0x0', { from: brightIdUser })
        const newAddresses = [brightIdUser2, brightIdUser]
        const newSig = getVerificationsSignatures(newAddresses, timestamps)
        await brightIdRegister.register(newAddresses, timestamps, newSig.v, newSig.r, newSig.s, ZERO_ADDRESS, '0x0', { from: brightIdUser2 })

        const isVerified = await brightIdRegister.isVerified(brightIdUser)

        assert.isFalse(isVerified, 'Incorrect is verified')
      })

      it('returns false when address not verified', async () => {
        const isVerified = await brightIdRegister.isVerified(brightIdUser)
        assert.isFalse(isVerified, 'Incorrect is verified')
      })
    })

    context('uniqueUserId(brightIdUser)', async () => {
      it('reverts when no unique user id', async () => {
        await assertRevert(brightIdRegister.uniqueUserId(brightIdUser), 'BRIGHTID_NO_UNIQUE_ID_ASSIGNED')
      })

      it('returns correct unique user id after registration', async () => {
        await brightIdRegister.register(addresses, timestamps, signatures.v, signatures.r, signatures.s, ZERO_ADDRESS, '0x0', { from: brightIdUser })

        const uniqueUserId = await brightIdRegister.uniqueUserId(brightIdUser)

        assert.equal(uniqueUserId, brightIdUser, 'Incorrect unique user id')
      })

      it('returns correct unique user id after multiple registrations', async () => {
        await brightIdRegister.register(addresses, timestamps, signatures.v, signatures.r, signatures.s, ZERO_ADDRESS, '0x0', { from: brightIdUser })
        const newAddresses = [brightIdUser2, brightIdUser]
        const newSig = getVerificationsSignatures(newAddresses, timestamps)
        await brightIdRegister.register(newAddresses, timestamps, newSig.v, newSig.r, newSig.s, ZERO_ADDRESS, '0x0', { from: brightIdUser2 })

        const user1UniqueId = await brightIdRegister.uniqueUserId(brightIdUser)
        const user2UniqueId = await brightIdRegister.uniqueUserId(brightIdUser2)

        assert.equal(user1UniqueId, brightIdUser, 'Incorrect user 1 unique id')
        assert.equal(user2UniqueId, brightIdUser, 'Incorrect user 2 unique id')
      })

      it('returns correct unique user id after registration with 2 addresses', async () => {
        const newAddresses = [brightIdUser2, brightIdUser]
        const newSig = getVerificationsSignatures(newAddresses, timestamps)
        await brightIdRegister.register(newAddresses, timestamps, newSig.v, newSig.r, newSig.s, ZERO_ADDRESS, '0x0', { from: brightIdUser2 })

        const user1UniqueId = await brightIdRegister.uniqueUserId(brightIdUser)
        const user2UniqueId = await brightIdRegister.uniqueUserId(brightIdUser2)

        assert.equal(user1UniqueId, brightIdUser, 'Incorrect user 1 unique id')
        assert.equal(user2UniqueId, brightIdUser, 'Incorrect user 2 unique id')
      })

      it('returns correct unique user id after registration with 3 addresses', async () => {
        const newAddresses = [brightIdUser3, brightIdUser2, brightIdUser]
        const newSig = getVerificationsSignatures(newAddresses, timestamps)
        await brightIdRegister.register(newAddresses, timestamps, newSig.v, newSig.r, newSig.s, ZERO_ADDRESS, '0x0', { from: brightIdUser3 })

        const user1UniqueId = await brightIdRegister.uniqueUserId(brightIdUser)
        const user3UniqueId = await brightIdRegister.uniqueUserId(brightIdUser3)

        assert.equal(user1UniqueId, brightIdUser, 'Incorrect user 1 unique id')
        await assertRevert(brightIdRegister.uniqueUserId(brightIdUser2), 'BRIGHTID_NO_UNIQUE_ID_ASSIGNED')
        assert.equal(user3UniqueId, brightIdUser, 'Incorrect user 3 unique id')
      })
    })

    context('hasUniqueUserId(brightIdUser)', async () => {
      it('returns false when no unique user id', async () => {
        assert.isFalse(await brightIdRegister.hasUniqueUserId(brightIdUser), 'Incorrect has unique user id')
      })

      it('returns true when unique user id is set', async () => {
        await brightIdRegister.register(addresses, timestamps, signatures.v, signatures.r, signatures.s, ZERO_ADDRESS, '0x0', { from: brightIdUser })

        assert.isTrue(await brightIdRegister.hasUniqueUserId(brightIdUser), 'Incorrect has unique user id')
      })
    })
  })
})
