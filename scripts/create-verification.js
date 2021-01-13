// Run with 'npx buidler run scripts/create-verification.js --network rinkeby'
// Requires the private key from the key you want to verify be in process.env.ETH_KEY as specified in buidler.config.js

const BrightIdRegister = artifacts.require('BrightIdRegister')
const ethers = require('ethers')

const BRIGHTID_REGISTER_ADDRESS = '0xc4841272033320735b11c4afb75c261ef6d8f3ec'
const VERIFICATIONS_PRIVATE_KEY = '0xd49743deccbccc5dc7baa8e69e5be03298da8688a15dd202e20f15d5e0e9a9fb' // Public address 0xead9c93b79ae7c1591b1fb5323bd777e86e150d4
const BRIGHT_ID_CONTEXT = '0x3168697665000000000000000000000000000000000000000000000000000000' // stringToBytes32("1hive")
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

const getVerificationsSignature = async (timestamp, contextIds) => {
  const hashedMessage = web3.utils.soliditySha3(
    BRIGHT_ID_CONTEXT,
    { type: 'address[]', value: contextIds },
    timestamp
  )
  const signingKey = new ethers.utils.SigningKey(VERIFICATIONS_PRIVATE_KEY)
  return signingKey.signDigest(hashedMessage)
}

const verifyWithBrightIdRegister = async () => {
  const timestamp = (await web3.eth.getBlock('latest')).timestamp
  const brightIdRegister = await BrightIdRegister.at(BRIGHTID_REGISTER_ADDRESS)
  const addressToVerify = (await web3.eth.getAccounts())[0]
  const contextIds = [addressToVerify]

  const signature = await getVerificationsSignature(timestamp, contextIds)

  console.log(`Registering ${addressToVerify}...`)
  await brightIdRegister.register(contextIds, [timestamp], [signature.v], [signature.r], [signature.s], ZERO_ADDRESS, '0x0')
  console.log('Is verified: ', await brightIdRegister.isVerified(addressToVerify))
}

verifyWithBrightIdRegister()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
