import { task, types } from "hardhat/config"
import { EthersAdapter } from "@safe-global/protocol-kit"
import Safe from "@safe-global/protocol-kit"

import { verify } from "./verify"
import { getProof } from "./utils"

import { ProofStructOutput, SafeTxParamsStruct } from "../types/Controller"

task("Peripheral:deploy", "deploy Peripheral")
  .addFlag("verify", "whether to verify the contract on Etherscan")
  .setAction(async (_taskArgs, hre) => {
    const Peripheral = await hre.ethers.getContractFactory("Peripheral")
    const peripheral = await Peripheral.deploy()
    console.log("Peripheral deployed at: ", peripheral.address)
    if (_taskArgs.verify) await verify(hre, peripheral, [])
  })

task("ControllerModule:deploy", "deploy ControllerModule")
  .addParam("sourceChainId", "source chain id", undefined, types.int)
  .addParam("sourceSafe", "Safe address in the source chain", undefined, types.string)
  .addParam("mainSafe", "main Safe address in the destination chain", undefined, types.string)
  .addParam("peripheral", "address of peripheral on the source chain", undefined, types.string)
  .addParam("giriGiriBashi", "address of GiriGiriBashi", undefined, types.string)
  .addFlag("verify", "whether to verify the contract on Etherscan")
  .setAction(async (_taskArgs, hre) => {
    const ControllerModule = await hre.ethers.getContractFactory("ControllerModule")
    const constructorArguments = [
      _taskArgs.sourceChainId,
      _taskArgs.sourceSafe,
      _taskArgs.mainSafe,
      _taskArgs.peripheral,
      _taskArgs.giriGiriBashi,
    ] as const
    const controllerModule = await ControllerModule.deploy(...constructorArguments)
    console.log("ControllerModule deployed at: ", controllerModule.address)
    if (_taskArgs.verify) await verify(hre, controllerModule, constructorArguments)
  })

task("ControllerModule:execTransaction:sendNativeToken", "Sends 1 wei")
  .addParam("controllerModule", "The controllerModule address", undefined, types.string)
  .addParam("destinationNetwork", "Destination network", undefined, types.string)
  .setAction(async (_taskArgs, hre) => {
    const { destinationNetwork, controllerModule: controllerModuleAddress } = _taskArgs
    const sourceNetwork = await hre.network.name

    const safeTxGas = "0"
    const baseGas = "0"
    const gasPrice = "1000000000"

    // Switch to destination network to get the signature
    await hre.changeNetwork(destinationNetwork)

    const ControllerModule = await hre.ethers.getContractFactory("ControllerModule")
    const controllerModule = await ControllerModule.attach(controllerModuleAddress)
    const peripheralAddress = await controllerModule.PERIPHERAL()
    const sourceSafeAddress = await controllerModule.SOURCE_SAFE()

    let accounts = await hre.ethers.getSigners()
    let safeOwner = accounts[0]
    const ethAdapterDestination = new EthersAdapter({
      ethers: hre.ethers,
      signerOrProvider: safeOwner,
    })

    const safeSdkDestination = await Safe.create({
      ethAdapter: ethAdapterDestination,
      safeAddress: await controllerModule.MAIN_SAFE(),
    }) // safe on dest
    const destinationTransaction = await safeSdkDestination.createTransaction({
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
        nonce: await safeSdkDestination.getNonce(),
      },
    })
    const safeTxHash = await safeSdkDestination.getTransactionHash(destinationTransaction)
    const signature = await safeSdkDestination.signTransactionHash(safeTxHash)

    // Switch to source network to call peripheral
    await hre.changeNetwork(sourceNetwork)

    accounts = await hre.ethers.getSigners()
    safeOwner = accounts[0]
    const ethAdapterSource = new EthersAdapter({
      ethers: hre.ethers,
      signerOrProvider: safeOwner,
    })
    const safeSdkSource = await Safe.create({ ethAdapter: ethAdapterSource, safeAddress: sourceSafeAddress }) // safe on source

    const Peripheral = await hre.ethers.getContractFactory("Peripheral")
    const peripheral = await Peripheral.attach(peripheralAddress)
    const peripheralNonce = await peripheral.nonce()

    const sourceTransaction = await safeSdkSource.createTransaction({
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
    const executeTxResponse = await safeSdkSource.executeTransaction(sourceTransaction)
    console.log("Source chain tx:", executeTxResponse.hash)
    const receipt = executeTxResponse.transactionResponse && (await executeTxResponse.transactionResponse.wait())

    const { blockHeaderRlp, accountProofRlp, storageProofRlp } = await getProof({
      blockNumber: receipt?.blockNumber,
      hre,
      peripheralAddress,
      sourceSafeAddress,
    })

    // Switch back to destination network to call controller module
    await hre.changeNetwork(destinationNetwork)
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
