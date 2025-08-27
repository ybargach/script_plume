const axios = require('axios');
const { ethers } = require('ethers');

const privateKey = process.env.PRIVATE_KEY; 
const amountToSwapDecimal = "0.001";
const totalTransactionsToRun = 450;
const minimumPlumeBalance = 30;
const maxGasFeePlume = 0.3;

const targetTokenSymbols = [
    'nETF', 'nPAYFI', 'nCREDIT', 'nBASIS', 'nELIXIR', 'nTBILL', 'nALPHA', 
    'USDT', 'USDC.e', 'pETH', 'pUSD', 'WETH', 'XAUM', 'mBASIS', 'mEDGE'
];

const provider = new ethers.providers.JsonRpcProvider("https://rpc.plume.org");
const wallet = new ethers.Wallet(privateKey, provider);

const erc20Abi = [
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)"
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

async function doSwap(toToken) {
  console.log(`\n🔄 Starting swap for ${toToken.symbol}...`);
  try {
    const fromToken = "0x0000000000000000000000000000000000000000";
    const amountInWei = ethers.utils.parseUnits(amountToSwapDecimal, 18);
    
    console.log(`  - Swapping ${amountToSwapDecimal} PLUME for ${toToken.symbol} (${toToken.address})`);

    const apiPayload = {
        inputTokenAddress: fromToken,
        outputTokenAddress: toToken.address,
        recipientAddress: wallet.address,
        amount: amountInWei.toString(),
        slippage: 1.0,
        amountOutMinimum: ""
    };

    const response = await axios.post('https://api.rooster-protocol.xyz/api/swap/callData', apiPayload, { headers: { 'Content-Type': 'application/json' }, timeout: 15000 });
    const txData = response.data;
    if (!txData || !txData.to || !txData.callData) {
        console.error(`❌ API did not return valid transaction data for ${toToken.symbol}.`);
        return true;
    }

    const tx = { to: txData.to, data: txData.callData, value: ethers.BigNumber.from(txData.value || "0") };
    tx.gasLimit = await provider.estimateGas({ ...tx, from: wallet.address });

    const gasPrice = await provider.getGasPrice();
    const estimatedFeeWei = tx.gasLimit.mul(gasPrice);
    const estimatedFeePlume = ethers.utils.formatEther(estimatedFeeWei);
    console.log(`  - Estimated fee: ${estimatedFeePlume} PLUME`);

    if (parseFloat(estimatedFeePlume) > maxGasFeePlume) {
        console.error(`❌ Estimated fee is too high. Skipping swap for ${toToken.symbol}.`);
        return false;
    }

    const swapTx = await wallet.sendTransaction(tx);
    console.log(`  - Swap transaction sent! View: https://explorer.plume.org/tx/${swapTx.hash}`);
    const receipt = await swapTx.wait();

    if (receipt.status === 1) console.log(`🎉 Swap for ${toToken.symbol} confirmed!`);
    else console.error(`❌ Swap for ${toToken.symbol} failed!`);
    
    return true;

  } catch (error) {
    console.error(`❌ An unexpected error occurred during the swap for ${toToken.symbol}.`);
    if (error.receipt) console.error(`   - On-Chain Failure. Hash: ${error.receipt.transactionHash}`);
    else if (error.response) console.error(`   - API Error: ${error.response.status}`);
    else console.error(`   - Message: ${error.message}`);
    return true; 
  }
}

async function swapBackToPlume(fromToken) {
    console.log(`\n🔍 Checking balance and preparing to swap back ${fromToken.symbol}...`);
    try {
        const tokenContract = new ethers.Contract(fromToken.address, erc20Abi, wallet);
        const balance = await tokenContract.balanceOf(wallet.address);

        if (balance.isZero()) {
            console.log(`  - No ${fromToken.symbol} balance to swap back. Skipping.`);
            return;
        }
        console.log(`  - Found ${ethers.utils.formatUnits(balance, fromToken.decimals)} ${fromToken.symbol}.`);

        const apiPayload = {
            inputTokenAddress: fromToken.address,
            outputTokenAddress: "0x0000000000000000000000000000000000000000",
            recipientAddress: wallet.address,
            amount: balance.toString(),
            slippage: 1.0,
            amountOutMinimum: ""
        };

        const response = await axios.post('https://api.rooster-protocol.xyz/api/swap/callData', apiPayload, { headers: { 'Content-Type': 'application/json' }, timeout: 15000 });
        const txData = response.data;
        if (!txData || !txData.to || !txData.callData) {
            console.error(`❌ API did not return valid swap-back data for ${fromToken.symbol}.`);
            return;
        }

        const spenderAddress = txData.to;
        console.log(`  - Approving router ${spenderAddress} to spend ${fromToken.symbol}...`);
        const approveTx = await tokenContract.approve(spenderAddress, balance);
        await approveTx.wait();
        console.log(`  - Approval confirmed!`);

        const tx = { to: txData.to, data: txData.callData, value: "0" };
        tx.gasLimit = await provider.estimateGas({ ...tx, from: wallet.address });

        const swapTx = await wallet.sendTransaction(tx);
        console.log(`  - Swap-back transaction sent! View: https://explorer.plume.org/tx/${swapTx.hash}`);
        const receipt = await swapTx.wait();

        if (receipt.status === 1) console.log(`🎉 Swap-back for ${fromToken.symbol} confirmed!`);
        else console.error(`❌ Swap-back for ${fromToken.symbol} failed!`);

    } catch (error) {
        console.error(`❌ An unexpected error occurred during the swap-back for ${fromToken.symbol}.`);
        if (error.receipt) console.error(`   - On-Chain Failure. Hash: ${error.receipt.transactionHash}`);
        else if (error.response) console.error(`   - API Error: ${error.response.status}`);
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

  console.log("\nFetching and filtering token list...");
  let tokensToSwap = [];
  try {
    const tokenListUrl = "https://assets.plume.org/plume.tokenlist.json";
    const response = await axios.get(tokenListUrl);
    const allTokens = response.data.tokens;
    tokensToSwap = allTokens.filter(token => targetTokenSymbols.includes(token.symbol));
    console.log(`✅ Found ${tokensToSwap.length} target tokens to cycle through.`);
  } catch (error) {
      console.error("❌ Failed to fetch token list. Stopping script.");
      return;
  }

  let transactionCount = 0;
  while (transactionCount < totalTransactionsToRun) {
    currentBalance = await checkNativeBalance();
    if (currentBalance <= minimumPlumeBalance) {
        console.error(`\n❌ Balance is ${currentBalance} PLUME (${minimumPlumeBalance} or less). Stopping main swap loop.`);
        break;
    }

    for (const token of tokensToSwap) {
        if (transactionCount >= totalTransactionsToRun) break;
        
        console.log(`\n--- Starting Transaction Attempt ${transactionCount + 1} of ${totalTransactionsToRun} ---`);
        const wasAttempted = await doSwap(token);
        if (wasAttempted) {
            transactionCount++;
        }

        if (transactionCount < totalTransactionsToRun) {
            console.log("----------------------------------------------------");
            await sleep(3500); 
        }
    }
  }

  console.log(`\n✅ Main swap loop finished after ${transactionCount} attempts.`);
  console.log("\n--- Starting Final Swap-Back to PLUME ---");

  for (const token of tokensToSwap) {
      await swapBackToPlume(token);
      console.log("----------------------------------------------------");
      await sleep(3500);
  }

  console.log("\n✅ All operations complete.");
  await checkNativeBalance();
}

main().catch(error => {
  console.error("\nFATAL SCRIPT ERROR:", error.message);
});
