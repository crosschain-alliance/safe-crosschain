import { task, types } from "hardhat/config"
import { EthersAdapter } from "@safe-global/protocol-kit"
import Safe from "@safe-global/protocol-kit"

import { verify } from "./verify"
import { getProof } from "./utils"

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

task("ControllerModule:deploy", "deploy ControllerModule")
  .addParam("sourceChainId", "source chain id", undefined, types.int)
  .addParam("mainSafe", "main Safe address", undefined, types.string)
  .addParam("secondarySafe", "Secondary Safe address in the source chain", undefined, types.string)
  .addParam("peripheral", "address of peripheral on the source chain", undefined, types.string)
  .addParam("shoyuBashi", "address of ShoyuBashi", undefined, types.string)
  .addFlag("verify", "whether to verify the contract on Etherscan")
  .setAction(async (_taskArgs, hre) => {
    const ControllerModule = await hre.ethers.getContractFactory("ControllerModule")
    const constructorArguments = [
      _taskArgs.sourceChainId,
      _taskArgs.mainSafe,
      _taskArgs.secondarySafe,
      _taskArgs.peripheral,
      _taskArgs.shoyuBashi,
    ] as const
    const controllerModule = await ControllerModule.deploy(...constructorArguments)
    console.log("ControllerModule deployed at: ", controllerModule.address)
    if (_taskArgs.verify) await verify(hre, controllerModule, constructorArguments)
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
    const peripheralAddress = await controllerModule.PERIPHERAL()
    const mainSafeAddress = await controllerModule.MAIN_SAFE()
    const secondarySafeAddress = await controllerModule.SECONDARY_SAFE()

    let accounts = await hre.ethers.getSigners()
    let safeOwner = accounts[0]
    const ethAdapterTarget = new EthersAdapter({
      ethers: hre.ethers,
      signerOrProvider: safeOwner,
    })

    const safeSdkTarget = await Safe.create({
      ethAdapter: ethAdapterTarget,
      safeAddress: secondarySafeAddress,
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
    const safeSdkMain = await Safe.create({ ethAdapter: ethAdapterMain, safeAddress: mainSafeAddress })

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
      mainSafeAddress,
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
