import { task, types } from "hardhat/config"
import { BigNumber } from "ethers"

import sendQuery from "../circuits/data/sendQuery.json"

task("AxiomV2Query:sendQuery", "send an on-chain Axiom query")
  .addParam("axiomV2Query", "AxiomV2Query address", undefined, types.string)
  .setAction(async (_args, hre) => {
    const [signer] = await hre.ethers.getSigners()

    const bnValue = BigNumber.from(sendQuery.value)
    const tx = await signer.sendTransaction({
      to: _args.axiomV2Query,
      data: sendQuery.calldata,
      value: bnValue.add(bnValue.mul("500").div("1000")),
      gasLimit: 5000000,
    })
    console.log("Transaction sent", tx.hash)
  })
