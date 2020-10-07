// Update ADDRESS_TO_VERIFY and run with 'npx buidler run scripts/create-verification.js --network rinkeby'

const BrightIdRegister = artifacts.require('BrightIdRegister')
const ethers = require('ethers')

const ADDRESS_TO_VERIFY = '0xdf456B614fE9FF1C7c0B380330Da29C96d40FB02'

const BRIGHTID_REGISTER_ADDRESS = '0xe13117651ebd5ec14e190b049eff7366f685c71a'
const VERIFICATIONS_PRIVATE_KEY = '0xd49743deccbccc5dc7baa8e69e5be03298da8688a15dd202e20f15d5e0e9a9fb' // Public address 0xead9c93b79ae7c1591b1fb5323bd777e86e150d4
const BRIGHT_ID_CONTEXT = '0x3168697665000000000000000000000000000000000000000000000000000000' // stringToBytes32("1hive")
const CONTEXT_IDS = [ADDRESS_TO_VERIFY]
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

const getVerificationsSignature = async (timestamp) => {
  const hashedMessage = web3.utils.soliditySha3(
    BRIGHT_ID_CONTEXT,
    { type: 'address[]', value: CONTEXT_IDS },
    timestamp
  )
  const signingKey = new ethers.utils.SigningKey(VERIFICATIONS_PRIVATE_KEY)
  const signDigest = signingKey.signDigest(hashedMessage)
  console.log(signDigest)

  return signDigest
}

const verifyWithBrightIdRegister = async () => {
  const timestamp = (await web3.eth.getBlock('latest')).timestamp
  const brightIdRegister = await BrightIdRegister.at(BRIGHTID_REGISTER_ADDRESS)
  const signature = await getVerificationsSignature(timestamp)

  console.log(`Registering ${ADDRESS_TO_VERIFY}...`)
  await brightIdRegister.register(BRIGHT_ID_CONTEXT, CONTEXT_IDS, timestamp, signature.v, signature.r, signature.s, ZERO_ADDRESS, '0x0')
  console.log('Is verified: ', await brightIdRegister.isVerified(ADDRESS_TO_VERIFY))
}

verifyWithBrightIdRegister()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
