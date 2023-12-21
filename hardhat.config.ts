import "@nomicfoundation/hardhat-toolbox"
import "hardhat-change-network"
import { config as dotenvConfig } from "dotenv"
import type { HardhatUserConfig } from "hardhat/config"
import type { NetworkUserConfig } from "hardhat/types"
import { resolve } from "path"

import "./tasks"

const dotenvConfigPath: string = process.env.DOTENV_CONFIG_PATH || "./.env"
dotenvConfig({ path: resolve(__dirname, dotenvConfigPath) })

// Ensure that we have all the environment variables we need.
const privateKey: string | undefined = process.env.PRIVATE_KEY
if (!privateKey) {
  throw new Error("Please set your PRIVATE_KEY in a .env file")
}

const infuraApiKey: string | undefined = process.env.INFURA_API_KEY
if (!infuraApiKey) {
  throw new Error("Please set your INFURA_API_KEY in a .env file")
}

const chainIds = {
  arbitrum: 42161,
  avalanche: 43114,
  "avalanche-fuji": 43113,
  bsc: 56,
  "bsc-testnet": 97,
  gnosis: 100,
  chiado: 10200,
  goerli: 5,
  hardhat: 31337,
  mainnet: 1,
  optimism: 10,
  "optimism-goerli": 420,
  polygon: 137,
  "polygon-mumbai": 80001,
  sepolia: 11155111,
}

function getChainConfig(chain: keyof typeof chainIds): NetworkUserConfig {
  let jsonRpcUrl: string = process.env[`${chain.toUpperCase()}_JSON_RPC_URL`] as string
  if (!jsonRpcUrl) {
    switch (chain) {
      case "mainnet":
        jsonRpcUrl = "https://ethereum.publicnode.com"
        break
      case "avalanche":
        jsonRpcUrl = "https://api.avax.network/ext/bc/C/rpc"
        break
      case "bsc":
        jsonRpcUrl = "https://bsc-dataseed1.binance.org"
        break
      case "gnosis":
        jsonRpcUrl = "https://rpc.gnosis.gateway.fm"
        break
      case "chiado":
        jsonRpcUrl = "https://rpc.chiadochain.net/"
        break
      default:
        jsonRpcUrl = `https://${chain}.infura.io/v3/${infuraApiKey}`
    }
  }

  return {
    accounts: [privateKey as string],
    chainId: chainIds[chain],
    url: jsonRpcUrl,
  }
}

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  etherscan: {
    apiKey: {
      arbitrumOne: process.env.ARBISCAN_API_KEY || "",
      avalanche: process.env.SNOWTRACE_API_KEY || "",
      bsc: process.env.BSCSCAN_API_KEY || "",
      bscTestnet: process.env.BSCSCAN_API_KEY || "",
      gnosis: process.env.GNOSISSCAN_API_KEY || "",
      goerli: process.env.ETHERSCAN_API_KEY || "",
      mainnet: process.env.ETHERSCAN_API_KEY || "",
      optimisticEthereum: process.env.OPTIMISM_API_KEY || "",
      polygon: process.env.POLYGONSCAN_API_KEY || "",
      polygonMumbai: process.env.POLYGONSCAN_API_KEY || "",
      sepolia: process.env.ETHERSCAN_API_KEY || "",
    },
  },
  gasReporter: {
    currency: "USD",
    enabled: process.env.REPORT_GAS ? true : false,
    excludeContracts: [],
    src: "./contracts",
  },
  networks: {
    hardhat: {
      accounts: {
        accountsBalance: "1000000000000000000000",
      },
      // Used for testing axiom
      // forking: {
      //   url: getChainConfig("mainnet").url,
      //   // block number of attestation block
      //   blockNumber: 10000000,
      // },
      chainId: chainIds.hardhat,
    },
    arbitrum: {
      ...getChainConfig("arbitrum"),
      gasPrice: 0.1e9,
    },
    avalanche: {
      ...getChainConfig("avalanche"),
      gasPrice: 230e9,
    },
    avalancheFuji: {
      ...getChainConfig("avalanche-fuji"),
      gasPrice: 10e9,
    },
    bsc: {
      ...getChainConfig("bsc"),
      gasPrice: 3e9,
    },
    "bsc-testnet": {
      ...getChainConfig("bsc-testnet"),
      gasPrice: 3e9,
    },
    gnosis: {
      ...getChainConfig("gnosis"),
      gasPrice: 15e9,
    },
    chiado: getChainConfig("chiado"),
    mainnet: {
      ...getChainConfig("mainnet"),
      gasPrice: 42e9,
    },
    optimism: {
      ...getChainConfig("optimism"),
      gasPrice: 0.05e9,
    },
    "optimism-goerli": {
      ...getChainConfig("optimism-goerli"),
      gasPrice: 0.05e9,
    },
    polygon: {
      ...getChainConfig("polygon"),
      gasPrice: 200e9,
    },
    "polygon-mumbai": getChainConfig("polygon-mumbai"),
    sepolia: getChainConfig("sepolia"),
    goerli: {
      ...getChainConfig("goerli"),
      gasPrice: 1e9,
    },
  },
  paths: {
    artifacts: "./artifacts",
    cache: "./cache",
    sources: "./contracts",
    tests: "./test",
    // tests: "./test_axiom",
  },
  solidity: {
    // can't use >= 0.8.18 because of this: https://github.com/safe-global/safe-contracts/issues/544
    version: "0.8.17",
    settings: {
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 800,
      },
    },
  },
  typechain: {
    outDir: "types",
    target: "ethers-v5",
  },
}

export default config
