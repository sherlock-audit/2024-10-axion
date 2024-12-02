import * as dotenv from "dotenv";

import { HardhatUserConfig, task } from "hardhat/config";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-verify";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";

dotenv.config();

task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
    const accounts = await hre.ethers.getSigners();
    for (const account of accounts) {
        console.log(account.address);
    }
});

const accounts = [process.env.DEPLOYER!]

const config: HardhatUserConfig = {
    solidity: {
        compilers: [
            {
                version: "0.8.19",
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 200,
                    },
                    viaIR: true,
                },
            },
        ],
    },
    networks: {
        localhost: {
            accounts: accounts,
        },
        blast: {
            url: "https://rpc.blast.io",
            accounts: accounts,
        },
        fantom: {
            url: "https://rpc.ftm.tools",
            accounts: accounts,
        },
        fantom_test: {
            url: "https://rpc.testnet.fantom.network",
            accounts: accounts,
        },
        mainnet: {
            url: "https://ethereum.publicnode.com",
            accounts: accounts,
        },
        bnb: {
            url: "https://bsc-dataseed.bnbchain.org",
            accounts: accounts,
        },
        polygon: {
            url: "https://polygon-rpc.com",
            accounts: accounts,
        },
        arbitrum: {
            url: "https://arb1.arbitrum.io/rpc",
            accounts: accounts,
        },
        avax: {
            url: "https://ava-mainnet.public.blastapi.io/ext/bc/C/rpc",
            accounts: accounts,
        },
        kava: {
            url: "https://evm.kava.io",
            accounts: accounts,
        },
        zkevm: {
            url: "https://zkevm-rpc.com",
            accounts: accounts,
        },
        op: {
            url: "https://optimism.llamarpc.com",
            accounts: accounts,
        },
        base: {
            url: "https://base.drpc.org",
            accounts: accounts,
        },
    },
    sourcify: {
        enabled: false,
    },
    gasReporter: {
        enabled: process.env.REPORT_GAS != undefined,
        currency: "USD",
    },
    etherscan: {
        apiKey: {
            fantom: process.env.FTMSCAN_API_KEY!,
            opera: process.env.FTMSCAN_API_KEY!,
            mainnet: process.env.ETHERSCAN_API_KEY!,
            blast: process.env.BLASTSCAN_API_KEY!,
            polygon: process.env.POLYGONSCAN_API_KEY!,
            base: process.env.BASESCAN_API_KEY!,
            bnb: process.env.BSCSCAN_API_KEY!,
        },
        customChains: [
            {
                network: "blast",
                chainId: 81457,
                urls: {
                    apiURL: "https://api.blastscan.io/api",
                    browserURL: "https://blastscan.io",
                },
            },
        ],
    },
};

export default config;