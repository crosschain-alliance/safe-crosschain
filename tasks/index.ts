import { task, types } from "hardhat/config"
import { EthersAdapter, SwapOwnerTxParams, RemoveOwnerTxParams } from "@safe-global/protocol-kit"
import Safe from "@safe-global/protocol-kit"
import { verify } from "./verify"
import { getProof } from "./utils"
import ControllerModuleABI from "../artifacts/contracts/ControllerModule.sol/ControllerModule.json"
import { ProofStructOutput, SafeTxParamsStruct } from "../types/Controller"

task("Peripheral:deploy", "deploy Peripheral")
  .addParam("targetNetwork", "target chain id", undefined, types.int)
  .addFlag("verify", "whether to verify the contract on Etherscan")
  .setAction(async (_taskArgs, hre) => {
    const Peripheral = await hre.ethers.getContractFactory("Peripheral")
    const constructorArguments = [_taskArgs.targetNetwork] as const
    const peripheral = await Peripheral.deploy(...constructorArguments)
    console.log("Peripheral deployed at: ", peripheral.address)
    if (_taskArgs.verify) await verify(hre, peripheral, constructorArguments)
  })

task("enableModule")
  .addParam("moduleaddress")
  .addParam("safe")
  .setAction(async (_taskArgs, hre) => {
    let accounts = await hre.ethers.getSigners()
    let safeOwner = accounts[0]
    const ethAdapter = new EthersAdapter({
      ethers: hre.ethers,
      signerOrProvider: safeOwner,
    })

    const safeSdk = await Safe.create({
      ethAdapter: ethAdapter,
      safeAddress: _taskArgs.safe,
    })

    const enableModuleTx = await safeSdk.createEnableModuleTx(_taskArgs.moduleaddress)
    const safeTx = await safeSdk.executeTransaction(enableModuleTx)
    console.log("module enabled ", safeTx.hash)
  })

task("removeOwnerOperation")
  .addParam("removeowner")
  .addParam("module")
  .addParam("targetnetwork")
  .addParam("mockadapter")
  .addParam("mainsafe")
  .setAction(async (_taskArgs, hre) => {
    const sourceChainID = (await hre.ethers.provider.getNetwork()).chainId
    const REMOVED_OWNER_TOPIC = "0xf8d49fc529812e9a7c5c50e69c20f0dccc0db8fa95c98bc58cc9a4f1c1299eaf"
    let accounts = await hre.ethers.getSigners()
    let safeOwner = accounts[0]
    const ethAdapterMain = new EthersAdapter({
      ethers: hre.ethers,
      signerOrProvider: safeOwner,
    })

    const safeSdkTarget = await Safe.create({
      ethAdapter: ethAdapterMain,
      safeAddress: _taskArgs.mainsafe,
    })
    const params: RemoveOwnerTxParams = {
      ownerAddress: _taskArgs.removeowner,
      threshold: 1, // Optional
    }

    const removeOwnerSafeTx = await safeSdkTarget.createRemoveOwnerTx(params)
    const removeOwnerTx = await safeSdkTarget.executeTransaction(removeOwnerSafeTx)
    console.log("Remove owner tx ", removeOwnerTx.hash)
    console.log("Wait for block header to be relayed...")
    await new Promise((resolve) => {
      setTimeout(() => {
        resolve("Resolved after 12 seconds")
      }, 12000)
    })

    const TxReceipt = await hre.ethers.provider.getTransactionReceipt(removeOwnerTx.hash)

    const txBlockHash = TxReceipt?.blockHash
    const txBlockNumber = TxReceipt?.blockNumber
    const mockAdapter = _taskArgs.mockadapter
    const setHashesAbi = ["function setHashes(uint256 domain, uint256[] memory ids, bytes32[] memory hashes) external"]

    await new Promise((resolve) => {
      setTimeout(() => {
        resolve("Resolved after 12 seconds")
      }, 12000)
    })
    
    // Need to relay a later block hash, to avoid error from Hashi Prover RPC: blockNumber must be greater than transaction.blockNumber 
     // TODO: fix error from Hashi RPC. Make it possible to use the same block for receipt proof
    const latestBlock = await hre.ethers.provider.getBlock(txBlockNumber + 1)
    const latestBlockHash = latestBlock?.hash

    // switch to target network
    await hre.changeNetwork(_taskArgs.targetnetwork)
    let accountOnTargetNetwork = await hre.ethers.getSigners()
    const adpaterContract = await hre.ethers.getContractAt(setHashesAbi, mockAdapter, accountOnTargetNetwork[0])
    const setHashesTx = await adpaterContract.setHashes(
      sourceChainID,
      [txBlockNumber, latestBlock.number],
      [txBlockHash, latestBlockHash],
    )
    console.log("set Hasehs on adapter contract", setHashesTx.hash)

    const removedOwnerLog = TxReceipt.logs.find((log) => log.topics[0] == REMOVED_OWNER_TOPIC)

    const ownerProofResponse = await fetch(`${process.env.HASHI_PROVER_URL}/v1`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "hashi_getReceiptProof",
        params: {
          logIndex: removedOwnerLog?.logIndex,
          blockNumber: latestBlock.number,
          chainId: sourceChainID,
          transactionHash: removedOwnerLog?.transactionHash,
        },
        id: 1,
      }),
    })
    const ownerProofResponseJSON = await ownerProofResponse.json()

    const thresholdSlot = "0x04"
    const thresholdStorageKey = hre.ethers.utils.hexZeroPad(thresholdSlot, 32)

    const thresholdProofResponse = await fetch(`${process.env.HASHI_PROVER_URL}/v1`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "hashi_getAccountAndStorageProof",
        params: {
          address: _taskArgs.mainsafe,
          blockNumber: txBlockNumber,
          chainId: sourceChainID,
          storageKeys: [thresholdStorageKey],
        },
        id: 1,
      }),
    })
    const thresholdProofResponseJSON = await thresholdProofResponse.json()

    // executeTransaction on Module
    const controllerModuleFactory = await hre.ethers.getContractAt(ControllerModuleABI.abi, _taskArgs.module)
    const removedOwnerTx = await controllerModuleFactory.removeOwnerOperation(
      ownerProofResponseJSON.result.proof,
      thresholdProofResponseJSON.result.proof,
      { gasLimit: 10_000_000 },
    )
    console.log("removed Owner Tx: ", removedOwnerTx.hash)
  })

task("swapOwnerOperation")
  .addParam("prevowner")
  .addParam("oldowner")
  .addParam("newowner")
  .addParam("mockadapter")
  .addParam("mainsafe")
  .addParam("module")
  .addParam("targetnetwork")
  .setAction(async (_taskArgs, hre) => {
    const ownerSlot = "0x2"
    const controllerModule = _taskArgs.module
    const sourceChainID = (await hre.ethers.provider.getNetwork()).chainId
    const paddedAddress = hre.ethers.utils.hexZeroPad(_taskArgs.prevowner, 32)
    const paddedSlot = hre.ethers.utils.hexZeroPad(ownerSlot, 32)
    const concatenated = hre.ethers.utils.concat([paddedAddress, paddedSlot])

    const storageKey = hre.ethers.utils.keccak256(concatenated)

    let accounts = await hre.ethers.getSigners()
    let safeOwner = accounts[0]
    const ethAdapterMain = new EthersAdapter({
      ethers: hre.ethers,
      signerOrProvider: safeOwner,
    })

    const safeSdkMain = await Safe.create({
      ethAdapter: ethAdapterMain,
      safeAddress: _taskArgs.mainsafe,
    })

    const param: SwapOwnerTxParams = {
      oldOwnerAddress: _taskArgs.oldowner,
      newOwnerAddress: _taskArgs.newowner,
    }
    const createSwapOwnerTxParam = await safeSdkMain.createSwapOwnerTx(param)
    const createSwapOwnerTx = await safeSdkMain.executeTransaction(createSwapOwnerTxParam)
    console.log("createSwapOwnerTx ", createSwapOwnerTx.hash)

    console.log("Wait for block header to be relayed...")
    await new Promise((resolve) => {
      setTimeout(() => {
        resolve("Resolved after 12 seconds")
      }, 12000)
    })

    const TxReceipt = await hre.ethers.provider.getTransactionReceipt(createSwapOwnerTx.hash)

    const blockHash = TxReceipt?.blockHash
    const blockNumber = TxReceipt?.blockNumber
    const setHashAbi = ["function setHashes(uint256 domain, uint256[] memory ids, bytes32[] memory hashes) external"]

    // switch to target network
    await hre.changeNetwork(_taskArgs.targetnetwork)
    let accountOnTargetNetwork = await hre.ethers.getSigners()
    const adpaterContract = await hre.ethers.getContractAt(setHashAbi, _taskArgs.mockadapter, accountOnTargetNetwork[0])
    const setHashesTx = await adpaterContract.setHashes(sourceChainID, [blockNumber], [blockHash])
    console.log("set Hasehs on adapter contract", setHashesTx.hash)

    const response = await fetch(`${process.env.HASHI_PROVER_URL}/v1`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "hashi_getAccountAndStorageProof",
        params: {
          address: _taskArgs.mainsafe,
          blockNumber: blockNumber,
          chainId: sourceChainID,
          storageKeys: [storageKey],
        },
        id: 1,
      }),
    })
    const data = await response.json()

    console.log(controllerModule)
    // executeTransaction on Module
    const controllerModuleFactory = await hre.ethers.getContractAt(ControllerModuleABI.abi, controllerModule)
    const swapOwnerTx = await controllerModuleFactory.swapOwnerOperation(data.result.proof, _taskArgs.prevowner, {
      gasLimit: 1_000_000,
    })
    console.log("swapOwnerTx on target network: ", swapOwnerTx.hash)
  })

task("addOwnerOperation")
  .addParam("mainsafe")
  .addParam("newowner")
  .addParam("threshold")
  .addParam("module")
  .addParam("targetnetwork")
  .addParam("mockadapter")
  .setAction(async (_taskArg, hre) => {
    // Create addOwner Transaction
    const sourceChainID = (await hre.ethers.provider.getNetwork()).chainId
    let accounts = await hre.ethers.getSigners()
    let safeOwner = accounts[0]
    const ethAdapterMain = new EthersAdapter({
      ethers: hre.ethers,
      signerOrProvider: safeOwner,
    })

    const safeSdkMain = await Safe.create({
      ethAdapter: ethAdapterMain,
      safeAddress: _taskArg.mainsafe,
    })
    const createAddOwnerTransaction = await safeSdkMain.createAddOwnerTx({
      ownerAddress: _taskArg.newowner,
      threshold: _taskArg.threshold,
    })

    const AddOwnerTransaction = await safeSdkMain.executeTransaction(createAddOwnerTransaction)
    console.log(`AddOwnerTransaction  ${AddOwnerTransaction.hash} on chainID ${sourceChainID}`)

    // Relay block header through Hashi, for testing only
    // Block header is relayed by Hashi team in production
    console.log("Wait for block relaying...")

    await new Promise((resolve) => {
      setTimeout(() => {
        resolve("Resolved after 12 seconds")
      }, 12000) // 12 seconds
    })

    const TxReceipt = await hre.ethers.provider.getTransactionReceipt(AddOwnerTransaction.hash)

    const blockHash = TxReceipt.blockHash
    const blockNumber = TxReceipt.blockNumber
    const setHashAbi = ["function setHashes(uint256 domain, uint256[] memory ids, bytes32[] memory hashes) external"]

    // switch to target network
    await hre.changeNetwork(_taskArg.targetnetwork)
    let accountOnTargetNetwork = await hre.ethers.getSigners()
    const adpaterContract = await hre.ethers.getContractAt(setHashAbi, _taskArg.mockadapter, accountOnTargetNetwork[0])
    const setHashesTx = await adpaterContract.setHashes(sourceChainID, [blockNumber], [blockHash])
    console.log("set block Hash on adapter contract", setHashesTx.hash)

    // Fetch proof from Hashi Prover
    // 1: Owner Proof
    const sentimentalOwner = "0x1"
    const ownerSlot = "0x2"
    const controllerModule = _taskArg.module
    const paddedAddress = hre.ethers.utils.hexZeroPad(sentimentalOwner, 32)
    const paddedSlot = hre.ethers.utils.hexZeroPad(ownerSlot, 32)
    const concatenated = hre.ethers.utils.concat([paddedAddress, paddedSlot])

    const ownerStorageKey = hre.ethers.utils.keccak256(concatenated)

    const ownerProofResponse = await fetch(`${process.env.HASHI_PROVER_URL}/v1`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "hashi_getAccountAndStorageProof",
        params: {
          address: _taskArg.mainsafe,
          blockNumber: blockNumber,
          chainId: sourceChainID,
          storageKeys: [ownerStorageKey],
        },
        id: 1,
      }),
    })
    const ownerProofResponseJSON = await ownerProofResponse.json()

    // 2: Threshold

    const thresholdSlot = "0x4"

    const thresholdStorageKey = hre.ethers.utils.hexZeroPad(thresholdSlot, 32)

    const thresholdProofResponse = await fetch(`${process.env.HASHI_PROVER_URL}/v1`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "hashi_getAccountAndStorageProof",
        params: {
          address: _taskArg.mainsafe,
          blockNumber: blockNumber,
          chainId: sourceChainID,
          storageKeys: [thresholdStorageKey],
        },
        id: 1,
      }),
    })
    const thresholdProofResponseJSON = await thresholdProofResponse.json()

    // executeTransaction on Module
    const controllerModuleFactory = await hre.ethers.getContractAt(ControllerModuleABI.abi, controllerModule)
    const addOwnerTx = await controllerModuleFactory.addOwnerOperation(
      ownerProofResponseJSON.result.proof,
      thresholdProofResponseJSON.result.proof,
      { gasLimit: 2_000_000 },
    )
    console.log("addOwnerTx on target network: ", addOwnerTx.hash)
  })

task("ControllerModule:deploy", "deploy ControllerModule")
  .addParam("sourcechainid", "source chain id", undefined, types.int)
  .addParam("mainsafe", "main Safe address", undefined, types.string)
  .addParam("secondarysafe", "Secondary Safe address in the source chain", undefined, types.string)
  .addParam("shoyubashi", "address of ShoyuBashi", undefined, types.string)
  .addFlag("verify", "whether to verify the contract on Etherscan")
  .setAction(async (_taskArgs, hre) => {
    const ControllerModule = await hre.ethers.getContractFactory("ControllerModule")
    const constructorArguments = [
      _taskArgs.sourcechainid,
      _taskArgs.mainsafe,
      _taskArgs.secondarysafe,
      _taskArgs.shoyubashi,
    ] as const
    const controllerModule = await ControllerModule.deploy(...constructorArguments)
    console.log("ControllerModule deployed at: ", controllerModule.address)
    if (_taskArgs.verify) await verify(hre, controllerModule, constructorArguments)

    let accounts = await hre.ethers.getSigners()
    let safeOwner = accounts[0]
    const ethAdapter = new EthersAdapter({
      ethers: hre.ethers,
      signerOrProvider: safeOwner,
    })

    const safeSdk = await Safe.create({
      ethAdapter: ethAdapter,
      safeAddress: _taskArgs.secondarysafe,
    })

    const enableModuleTxParams = await safeSdk.createEnableModuleTx(controllerModule.address)
    const enableModuleTx = await safeSdk.executeTransaction(enableModuleTxParams)
    console.log("Module enabled ", enableModuleTx.hash)
  })

task("ControllerModule:execTransaction:sendNativeToken", "Sends 1 wei")
  .addParam("controllerModule", "The controllerModule address", undefined, types.string)
  .addParam("targetNetwork", "Destination network", undefined, types.string)
  .setAction(async (_taskArgs, hre) => {
    const { targetNetwork, controllerModule: controllerModuleAddress } = _taskArgs
    const mainNetwork = await hre.network.name

    const safeTxGas = "0"
    const baseGas = "0"
    const gasPrice = "1000000000"

    // Switch to target network to get the signature
    await hre.changeNetwork(targetNetwork)

    const ControllerModule = await hre.ethers.getContractFactory("ControllerModule")
    const controllerModule = await ControllerModule.attach(controllerModuleAddress)
    const peripheralAddress = await controllerModule.peripheralContract()
    const mainsafeAddress = await controllerModule.MAIN_SAFE()
    const secondarysafeAddress = await controllerModule.SECONDARY_SAFE()

    let accounts = await hre.ethers.getSigners()
    let safeOwner = accounts[0]
    const ethAdapterTarget = new EthersAdapter({
      ethers: hre.ethers,
      signerOrProvider: safeOwner,
    })

    const safeSdkTarget = await Safe.create({
      ethAdapter: ethAdapterTarget,
      safeAddress: secondarysafeAddress,
    })
    const targetTransaction = await safeSdkTarget.createTransaction({
      safeTransactionData: {
        to: safeOwner.address,
        value: "1",
        data: "0x",
        operation: 0,
        safeTxGas,
        baseGas,
        gasPrice,
        gasToken: "0x0000000000000000000000000000000000000000",
        refundReceiver: safeOwner.address,
        nonce: await safeSdkTarget.getNonce(),
      },
    })
    const safeTxHash = await safeSdkTarget.getTransactionHash(targetTransaction)
    const signature = await safeSdkTarget.signTransactionHash(safeTxHash)

    // Switch to source network to call peripheral
    await hre.changeNetwork(mainNetwork)

    accounts = await hre.ethers.getSigners()
    safeOwner = accounts[0]
    const ethAdapterMain = new EthersAdapter({
      ethers: hre.ethers,
      signerOrProvider: safeOwner,
    })
    const safeSdkMain = await Safe.create({ ethAdapter: ethAdapterMain, safeAddress: mainsafeAddress })

    const Peripheral = await hre.ethers.getContractFactory("Peripheral")
    const peripheral = await Peripheral.attach(peripheralAddress)
    const peripheralNonce = await peripheral.nonce()

    const mainTransaction = await safeSdkMain.createTransaction({
      safeTransactionData: {
        to: peripheralAddress,
        value: "0",
        data: (
          await peripheral.populateTransaction.execTransaction(
            safeOwner.address,
            1,
            "0x",
            0,
            safeTxGas,
            baseGas,
            gasPrice,
            "0x0000000000000000000000000000000000000000",
            safeOwner.address,
            signature.data,
          )
        ).data as string,
        operation: 0,
        safeTxGas: "500000",
        baseGas: "0",
        gasPrice: "0",
        gasToken: "0x0000000000000000000000000000000000000000",
        refundReceiver: safeOwner.address,
      },
    })
    const executeTxResponse = await safeSdkMain.executeTransaction(mainTransaction)
    console.log("Source chain tx:", executeTxResponse.hash)
    const receipt = executeTxResponse.transactionResponse && (await executeTxResponse.transactionResponse.wait())

    const { blockHeaderRlp, accountProofRlp, storageProofRlp } = await getProof({
      blockNumber: receipt?.blockNumber,
      hre,
      peripheralAddress,
      mainsafeAddress,
    })

    // Switch back to target network to call controller module
    await hre.changeNetwork(targetNetwork)
    const tx = await controllerModule.execTransaction(
      [
        safeOwner.address,
        1,
        "0x",
        0, // Call
        safeTxGas,
        baseGas,
        gasPrice,
        "0x0000000000000000000000000000000000000000",
        safeOwner.address,
        signature.data,
      ] as SafeTxParamsStruct,
      [receipt?.blockNumber, peripheralNonce, blockHeaderRlp, accountProofRlp, storageProofRlp] as ProofStructOutput,
      {
        gasLimit: 750000,
      },
    )
    console.log("Destination chain tx: ", tx.hash)

    /*console.log({
      safeAddress,
      blockNumber,
      nonce,
      blockHeaderRlp: bytesToHex(RLP.encode(blockHeaderRlp)),
      accountProof: bytesToHex(RLP.encode(accountProof.map((_part: string) => RLP.decode(_part)))),
      storageProof: bytesToHex(RLP.encode(storageProof[0].proof.map((_part: string) => RLP.decode(_part)))),
    })*/
  })
