const { usePlugin } = require('@nomiclabs/buidler/config')

usePlugin('@aragon/buidler-aragon')

module.exports = {
  // Default Buidler configurations. Read more about it at https://buidler.dev/config/
  defaultNetwork: 'localhost',
  networks: {
    localhost: {
      url: 'http://localhost:8545',
    },
    rinkeby: {
      url: 'https://rinkeby.eth.aragon.network',
      accounts: [
        process.env.ETH_KEY ||
        '0xa8a54b2d8197bc0b19bb8a084031be71835580a01e70a45a13babd16c9bc1563',
      ],
      gas: 7.9e6,
      gasPrice: 15000000001
    },
  },
  solc: {
    version: '0.4.24',
    optimizer: {
      enabled: true,
      runs: 10000,
    },
  },
  // Etherscan plugin configuration. Learn more at https://github.com/nomiclabs/buidler/tree/master/packages/buidler-etherscan
  etherscan: {
    apiKey: '', // API Key for smart contract verification. Get yours at https://etherscan.io/apis
  },
}
