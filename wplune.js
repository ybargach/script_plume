const { ethers } = require('ethers');

const privateKey = process.env.PRIVATE_KEY;
const amountToWrapDecimal = "0.1";
const totalCyclesToRun = 3000;
const minimumPlumeBalance = 30;
const maxGasFeePlume = 0.30;

const provider = new ethers.providers.JsonRpcProvider("https://rpc.plume.org");
const wallet = new ethers.Wallet(privateKey, provider);

const WPLUME_ADDRESS = "0xEa237441c92CAe6FC17Caaf9a7acB3f953be4bd1";

const wplumeAbi = [
    "function deposit() public payable",
    "function withdraw(uint wad) public",
    "function balanceOf(address owner) view returns (uint)"
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

async function wrapPlume() {
  console.log("\n🔄 Starting PLUME wrapping process...");
  try {
    const amountInWei = ethers.utils.parseUnits(amountToWrapDecimal, 18);
    console.log(`  - Preparing to wrap ${amountToWrapDecimal} PLUME...`);

    const wplumeContract = new ethers.Contract(WPLUME_ADDRESS, wplumeAbi, wallet);

    console.log("  - Estimating gas fee for wrapping...");
    const gasLimit = await wplumeContract.estimateGas.deposit({ value: amountInWei });
    const gasPrice = await provider.getGasPrice();
    const estimatedFeeWei = gasLimit.mul(gasPrice);
    const estimatedFeePlume = ethers.utils.formatEther(estimatedFeeWei);
    console.log(`  - Estimated fee: ${estimatedFeePlume} PLUME`);

    if (parseFloat(estimatedFeePlume) > maxGasFeePlume) {
        console.error(`❌ Estimated fee is too high. Skipping wrap.`);
        return null;
    }

    const tx = await wplumeContract.deposit({ value: amountInWei, gasLimit: gasLimit.add(20000) });
    console.log(`  - Wrap transaction sent! View: https://explorer.plume.org/tx/${tx.hash}`);
    const receipt = await tx.wait();

    if (receipt.status === 1) {
        console.log(`🎉 Wrap confirmed!`);
        return amountInWei;
    } else {
        console.error(`❌ Wrap transaction failed!`);
        return null;
    }
  } catch (error) {
    console.error("❌ An unexpected error occurred during the wrapping process.");
    if (error.receipt) console.error(`   - On-Chain Failure. Hash: ${error.receipt.transactionHash}`);
    else console.error(`   - Message: ${error.message}`);
    return null;
  }
}

async function unwrapWplume(amountToUnwrapWei) {
    console.log("\n🔄 Starting WPLUME unwrapping process...");
    try {
        const wplumeContract = new ethers.Contract(WPLUME_ADDRESS, wplumeAbi, wallet);
        
        const balanceWei = await wplumeContract.balanceOf(wallet.address);
        console.log(`  - Current WPLUME balance: ${ethers.utils.formatEther(balanceWei)}`);

        if (balanceWei.lt(amountToUnwrapWei)) {
            console.error("❌ Not enough WPLUME to unwrap. Skipping.");
            return;
        }

        console.log(`  - Preparing to unwrap ${ethers.utils.formatEther(amountToUnwrapWei)} WPLUME...`);

        console.log("  - Estimating gas fee for unwrapping...");
        const gasLimit = await wplumeContract.estimateGas.withdraw(amountToUnwrapWei);
        const gasPrice = await provider.getGasPrice();
        const estimatedFeeWei = gasLimit.mul(gasPrice);
        const estimatedFeePlume = ethers.utils.formatEther(estimatedFeeWei);
        console.log(`  - Estimated fee: ${estimatedFeePlume} PLUME`);

        if (parseFloat(estimatedFeePlume) > maxGasFeePlume) {
            console.error(`❌ Estimated fee is too high. Skipping unwrap.`);
            return;
        }

        const tx = await wplumeContract.withdraw(amountToUnwrapWei, { gasLimit: gasLimit.add(20000) });
        console.log(`  - Unwrap transaction sent! View: https://explorer.plume.org/tx/${tx.hash}`);
        const receipt = await tx.wait();

        if (receipt.status === 1) {
            console.log(`🎉 Unwrap confirmed!`);
        } else {
            console.error(`❌ Unwrap transaction failed!`);
        }

    } catch (error) {
        console.error("❌ An unexpected error occurred during the unwrapping process.");
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

  for (let i = 1; i <= totalCyclesToRun; i++) {
    console.log(`\n--- Starting Cycle ${i} of ${totalCyclesToRun} ---`);

    currentBalance = await checkNativeBalance();
    if (currentBalance <= minimumPlumeBalance) {
        console.error(`\n❌ Balance is too low. Stopping script.`);
        break;
    }

    const wrappedAmount = await wrapPlume();

    if (wrappedAmount) {
        await sleep(3500); 
        await unwrapWplume(wrappedAmount);
    }

    if (i < totalCyclesToRun) {
        console.log("----------------------------------------------------");
        await sleep(3500);
    }
  }

  console.log("\n✅ All cycles complete.");
  await checkNativeBalance();
}

main().catch(error => {
  console.error("\nFATAL SCRIPT ERROR:", error.message);
});
