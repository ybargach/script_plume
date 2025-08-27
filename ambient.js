const axios = require('axios');
const { ethers } = require('ethers');

const privateKey = process.env.PRIVATE_KEY;
const totalTransactionsToRun = 3000;
const minimumPlumeBalance = 30;

const swapPairsConfig = [
    { pair: ['USDC.e', 'pUSD'], amount: "0.00001" },
    { pair: ['pUSD', 'USDT'], amount: "0.00001" },
    { pair: ['WETH', 'pUSD'], amount: "0.0000001" },
    { pair: ['WETH', 'pETH'], amount: "0.0000001" },
    { pair: ['nALPHA', 'pUSD'], amount: "0.00001" },
    { pair: ['nTBILL', 'pUSD'], amount: "0.00001" },
    { pair: ['nCREDIT', 'pUSD'], amount: "0.00001" },
    { pair: ['USDT', 'USDC.e'], amount: "0.00001" }
];

const manualTokenList = [
    { name: "Wrapped PLUME", symbol: "WPLUME", decimals: 18, address: "0xEa237441c92CAe6FC17Caaf9a7acB3f953be4bd1" },
    { name: "Wrapped Ether (Stargate)", symbol: "WETH", decimals: 18, address: "0xca59cA09E5602fAe8B629DeE83FfA819741f14be" },
    { name: "Plume USD", symbol: "pUSD", decimals: 6, address: "0xdddD73F5Df1F0DC31373357beAC77545dC5A6f3F" },
    { name: "Plume ETH", symbol: "pETH", decimals: 18, address: "0x39d1F90eF89C52dDA276194E9a832b484ee45574" },
    { name: "Bridged USDC (Stargate)", symbol: "USDC.e", decimals: 6, address: "0x78adD880A697070c1e765Ac44D65323a0DcCE913" },
    { name: "Bridged USDT (Stargate)", symbol: "USDT", decimals: 6, address: "0xda6087E69C51E7D31b6DBAD276a3c44703DFdCAd" },
    { name: "Nest ALPHA Vault", symbol: "nALPHA", decimals: 6, address: "0x593cCcA4c4bf58b7526a4C164cEEf4003C6388db" },
    { name: "Nest Treasuries Vault", symbol: "nTBILL", decimals: 6, address: "0xe72fe64840f4ef80e3ec73a1c749491b5c938cb9" },
    { name: "Nest Basis Vault", symbol: "nBASIS", decimals: 6, address: "0x11113Ff3a60C2450F4b22515cB760417259eE94B" },
    { name: "Nest Credit Vault", symbol: "nCREDIT", decimals: 6, address: "0xa5f78b2a0ab85429d2dfbf8b60abc70f4cec066c" }
];

const provider = new ethers.providers.JsonRpcProvider("https://rpc.plume.org");
const wallet = new ethers.Wallet(privateKey, provider);
const AMBIENT_DEX_ADDRESS = "0xAaAaAAAA81a99d2a05eE428eC7a1d8A3C2237D85"; 

const MIN_SQRT_PRICE = "65538";
const MAX_SQRT_PRICE = "79226673515401279992447579055";

const erc20Abi = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)"
];
const ambientDexAbi = [ 
    "function userCmd(uint16 callpath, bytes data) external payable"
];

async function checkConnection() {
  try {
    const blockNumber = await provider.getBlockNumber();
    console.log(`✅ Connected to Plume Network! Current block number: ${blockNumber}`);
  } catch (error) {
    console.error("❌ Failed to connect to the RPC provider:", error.message);
    throw error;
  }
}

async function checkNativeBalance() {
  try {
    const balanceWei = await wallet.getBalance();
    const balancePlume = ethers.utils.formatEther(balanceWei);
    console.log(`💰 Native Balance: ${balancePlume} PLUME`);
    return parseFloat(balancePlume);
  } catch (error) {
    console.error("❌ Error checking native balance:", error.message);
    return 0;
  }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function doAmbientSwap(baseToken, quoteToken, amountToSwapDecimal) {
  try {
    const tokenToSendContract = new ethers.Contract(baseToken.address, erc20Abi, wallet);
    const amountInWei = ethers.utils.parseUnits(amountToSwapDecimal, baseToken.decimals);

    console.log(`🪙 Preparing to swap ${amountToSwapDecimal} ${baseToken.symbol} for ${quoteToken.symbol}...`);

    const currentAllowance = await tokenToSendContract.allowance(wallet.address, AMBIENT_DEX_ADDRESS);
    if (currentAllowance.lt(amountInWei)) {
        console.log(`  - Allowance for ${baseToken.symbol} is too low. Sending approve transaction...`);
        const approveTx = await tokenToSendContract.approve(AMBIENT_DEX_ADDRESS, ethers.constants.MaxUint256);
        await approveTx.wait();
        console.log("  - Approval confirmed!");
    } else {
        console.log(`  - Sufficient allowance for ${baseToken.symbol} already set.`);
    }

    console.log("  - Bypassing simulation and executing swap directly...");
    const ambientDexContract = new ethers.Contract(AMBIENT_DEX_ADDRESS, ambientDexAbi, wallet);
    
    const poolIdx = 420;
    const isBuy = true;
    const inBaseQty = true;
    const qty = amountInWei;
    const tip = 0;
    const limitPrice = MAX_SQRT_PRICE;
    const minOut = 0;
    const settleFlags = 0; 

    const encodedData = ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'bool', 'bool', 'uint128', 'uint16', 'uint128', 'uint128', 'uint8'],
        [baseToken.address, quoteToken.address, poolIdx, isBuy, inBaseQty, qty, tip, limitPrice, minOut, settleFlags]
    );

    const txResponse = await ambientDexContract.userCmd(1, encodedData, { gasLimit: 1000000 });
    console.log(`✅ Swap transaction sent! View: https://explorer.plume.org/tx/${txResponse.hash}`);
    const receipt = await txResponse.wait();

    if (receipt.status === 1) console.log(`🎉 Swap confirmed!`);
    else console.error(`❌ Swap transaction failed!`);

  } catch (error) {
    console.error(`❌ An unexpected error occurred during the swap for ${baseToken.symbol} -> ${quoteToken.symbol}.`);
    if (error.receipt) console.error(`   - On-Chain Failure. Hash: ${error.receipt.transactionHash}`);
    else console.error(`   - Message: ${error.message}`);
  }
}

async function main() {
  await checkConnection();

  let currentBalance = await checkNativeBalance();
  if (currentBalance <= minimumPlumeBalance) {
    console.error(`❌ Initial balance is ${minimumPlumeBalance} PLUME or less. Stopping script.`);
    return;
  }

  console.log("\nPreparing token pairs from manual list...");
  let swapPairs = [];
  try {
    const tokenMap = new Map(manualTokenList.map(token => [token.symbol, token]));

    for (const config of swapPairsConfig) {
        const tokenA = tokenMap.get(config.pair[0]);
        const tokenB = tokenMap.get(config.pair[1]);

        if (tokenA && tokenB) {
            if (tokenA.address.toLowerCase() < tokenB.address.toLowerCase()) {
                swapPairs.push({ base: tokenA, quote: tokenB, amount: config.amount });
            } else {
                swapPairs.push({ base: tokenB, quote: tokenA, amount: config.amount });
            }
        } else {
            console.warn(`- Could not find both tokens for pair: ${config.pair[0]}/${config.pair[1]}. Skipping.`);
        }
    }
    console.log(`✅ Prepared ${swapPairs.length} valid token pairs for swapping.`);

  } catch (error) {
      console.error("❌ Failed to process the manual token list. Stopping script.");
      return;
  }

  let transactionCount = 0;
  while (transactionCount < totalTransactionsToRun) {
    for (const pairConfig of swapPairs) {
        if (transactionCount >= totalTransactionsToRun) break;

        currentBalance = await checkNativeBalance();
        if (currentBalance <= minimumPlumeBalance) {
            console.error(`\n❌ Balance is too low. Stopping script.`);
            transactionCount = totalTransactionsToRun;
            break;
        }

        console.log(`\n--- Starting Transaction Attempt ${transactionCount + 1} of ${totalTransactionsToRun} ---`);
        await doAmbientSwap(pairConfig.base, pairConfig.quote, pairConfig.amount);
        transactionCount++;

        if (transactionCount < totalTransactionsToRun) {
            console.log("----------------------------------------------------");
            await sleep(3500); 
        }
    }
  }

  console.log(`\n✅ Loop finished after ${transactionCount} attempts.`);
}

main().catch(error => {
  console.error("\nFATAL SCRIPT ERROR:", error.message);
});