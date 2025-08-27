const axios = require('axios');
const { ethers } = require('ethers');

const privateKey = process.env.PRIVATE_KEY; 
const amountToSwapDecimal = "0.1"; 
const totalTransactionsToRun = 50; 
const minimumPlumeBalance = 30; 
const maxGasFeePlume = 0.30; 

const targetTokenSymbols = [
    "pETH", "pUSD", "USDC.e", "USDT", "WETH", 
    "nBASIS", "nTBILL", "nELIXIR"
];

const manualTokenList = [
    { name: "Wrapped PLUME", symbol: "WPLUME", decimals: 18, address: "0xEa237441c92CAe6FC17Caaf9a7acB3f953be4bd1" },
    { name: "Wrapped Ether (Stargate)", symbol: "WETH", decimals: 18, address: "0xca59cA09E5602fAe8B629DeE83FfA819741f14be" },
    { name: "Plume USD", symbol: "pUSD", decimals: 6, address: "0xdddD73F5Df1F0DC31373357beAC77545dC5A6f3F" },
    { name: "Plume ETH", symbol: "pETH", decimals: 18, address: "0x39d1F90eF89C52dDA276194E9a832b484ee45574" },
    { name: "Bridged USDC (Stargate)", symbol: "USDC.e", decimals: 6, address: "0x78adD880A697070c1e765Ac44D65323a0DcCE913" },
    { name: "Bridged USDT (Stargate)", symbol: "USDT", decimals: 6, address: "0xda6087E69C51E7D31b6DBAD276a3c44703DFdCAd" },
    { name: "Nest Basis Vault", symbol: "nBASIS", decimals: 6, address: "0x11113Ff3a60C2450F4b22515cB760417259eE94B" },
    { name: "Nest Treasuries Vault", symbol: "nTBILL", decimals: 6, address: "0xe72fe64840f4ef80e3ec73a1c749491b5c938cb9" },
    { name: "Nest Institutional Core Vault", symbol: "nELIXIR", decimals: 6, address: "0x9fbC367B9Bb966a2A537989817A088AFCaFFDC4c" }
];

const provider = new ethers.providers.JsonRpcProvider("https://rpc.plume.org");
const wallet = new ethers.Wallet(privateKey, provider);

const CAMELOT_ROUTER_ADDRESS_RAW = "0x10aA510d94E094Bd643677bd2964c3EE085Daffc";
const CAMELOT_ROUTER_ADDRESS = ethers.utils.getAddress(CAMELOT_ROUTER_ADDRESS_RAW.toLowerCase());

const camelotRouterAbi = [
    "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)",
    "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] calldata path, address to, address referrer, uint deadline) external payable"
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

async function doCamelotSwap(toToken) {
  console.log(`\n🔄 Starting swap for ${toToken.symbol}...`);
  try {
    const amountInWei = ethers.utils.parseUnits(amountToSwapDecimal, 18);
    console.log(`  - Swapping ${amountToSwapDecimal} PLUME for ${toToken.symbol}...`);

    const camelotRouter = new ethers.Contract(CAMELOT_ROUTER_ADDRESS, camelotRouterAbi, wallet);
    const wplumeAddress = manualTokenList.find(t => t.symbol === "WPLUME").address;

    const path = [wplumeAddress, toToken.address];
    
    const amountsOut = await camelotRouter.getAmountsOut(amountInWei, path);
    const expectedAmountOut = amountsOut[1];
    const amountOutMin = expectedAmountOut.mul(95).div(100);

    console.log(`  - Quote received: Expecting ~${ethers.utils.formatUnits(expectedAmountOut, toToken.decimals)} ${toToken.symbol}`);

    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

    const txRequest = await camelotRouter.populateTransaction.swapExactETHForTokensSupportingFeeOnTransferTokens(
        amountOutMin, path, wallet.address, ethers.constants.AddressZero, deadline, { value: amountInWei }
    );
    const gasLimit = await provider.estimateGas(txRequest);
    const gasPrice = await provider.getGasPrice();
    const estimatedFeePlume = ethers.utils.formatEther(gasLimit.mul(gasPrice));
    console.log(`  - Estimated fee: ${estimatedFeePlume} PLUME`);

    if (parseFloat(estimatedFeePlume) > maxGasFeePlume) {
        console.error(`❌ Estimated fee is too high. Skipping swap for ${toToken.symbol}.`);
        return false;
    }

    const tx = await wallet.sendTransaction({ ...txRequest, gasLimit: gasLimit.add(20000) });
    console.log(`  - Swap transaction sent! View: https://explorer.plume.org/tx/${tx.hash}`);
    const receipt = await tx.wait();

    if (receipt.status === 1) console.log(`🎉 Swap for ${toToken.symbol} confirmed!`);
    else console.error(`❌ Swap for ${toToken.symbol} failed!`);
    
    return true;

  } catch (error) {
    console.error(`❌ An unexpected error occurred during the swap for ${toToken.symbol}.`);
    if (error.receipt) console.error(`   - On-Chain Failure. Hash: ${error.receipt.transactionHash}`);
    else console.error(`   - Message: ${error.message}`);
    return true;
  }
}

async function main() {
  await checkConnection();

  let currentBalance = await checkNativeBalance();
  if (currentBalance <= minimumPlumeBalance) {
    console.error(`❌ Initial balance is ${minimumPlumeBalance} PLUME or less. Stopping script.`);
    return;
  }

  const tokenMap = new Map(manualTokenList.map(token => [token.symbol, token]));
  const tokensToSwap = targetTokenSymbols.map(symbol => tokenMap.get(symbol)).filter(Boolean);

  console.log(`\n✅ Prepared ${tokensToSwap.length} valid tokens to cycle through.`);

  let transactionCount = 0;
  while (transactionCount < totalTransactionsToRun) {
    for (const token of tokensToSwap) {
        if (transactionCount >= totalTransactionsToRun) break;

        currentBalance = await checkNativeBalance();
        if (currentBalance <= minimumPlumeBalance) {
            console.error(`\n❌ Balance is too low. Stopping script.`);
            transactionCount = totalTransactionsToRun; 
            break;
        }

        console.log(`\n--- Starting Transaction Attempt ${transactionCount + 1} of ${totalTransactionsToRun} ---`);
        const wasAttempted = await doCamelotSwap(token);
        
        if (wasAttempted) {
            transactionCount++;
        }

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
