import { hexlify } from "ethers/lib/utils"
import { HardhatRuntimeEnvironment } from "hardhat/types"
import { Trie } from "@ethereumjs/trie"
import { hexToBytes, compareBytes } from "@ethereumjs/util"
import { RLP } from "@ethereumjs/rlp"

const emptyHexlify = (_value: string) => {
  const hex = hexlify(_value, { hexPad: "left" })
  return hex === "0x00" ? "0x" : hex
}

const rlpEncodeBlock = (_block: any) => {
  const values = [
    _block.parentHash,
    _block.sha3Uncles,
    _block.miner,
    _block.stateRoot,
    _block.transactionsRoot,
    _block.receiptsRoot,
    _block.logsBloom,
    _block.difficulty,
    _block.number,
    _block.gasLimit,
    _block.gasUsed,
    _block.timestamp,
    _block.extraData,
    _block.mixHash,
    _block.nonce,
    _block.baseFeePerGas,
  ]
  return RLP.encode(values.map(emptyHexlify))
}

const getBlock = (_blockNumber: number, _hre: HardhatRuntimeEnvironment) =>
  _hre.ethers.provider.send("eth_getBlockByNumber", [hexlify(_blockNumber), false])

const getRlpEncodedBlockHeaderByBlockNumber = async (_blockNumber: number, _hre: HardhatRuntimeEnvironment) => {
  const block = await getBlock(_blockNumber, _hre)
  return rlpEncodeBlock(block)
}

export const getProof = async ({ blockNumber, hre, peripheralAddress, mainSafeAddress }: any) => {
  const block = await getBlock(blockNumber, hre)
  // TODO: ensure that encoding fx works
  const blockHeaderRlp = await getRlpEncodedBlockHeaderByBlockNumber(blockNumber, hre)

  const storageKey = hre.ethers.utils.keccak256(
    hre.ethers.utils.defaultAbiCoder.encode(["address", "uint256"], [mainSafeAddress, 0]),
  )
  const {
    accountProof,
    balance,
    codeHash,
    nonce: accountNonce,
    storageHash,
    storageProof,
  } = await hre.ethers.provider.send("eth_getProof", [
    peripheralAddress,
    [storageKey],
    hre.ethers.utils.hexlify(blockNumber),
  ])

  const accountsTrie = new Trie()
  const accountProofValueRlp = await accountsTrie.verifyProof(
    hexToBytes(block.stateRoot),
    hexToBytes(hre.ethers.utils.solidityKeccak256(["address"], [peripheralAddress])),
    accountProof.map(hexToBytes),
  )
  const accounValueRlp = RLP.encode([
    hexToBytes(accountNonce),
    hexToBytes(balance === "0x0" ? "0x" : balance),
    hexToBytes(storageHash),
    hexToBytes(codeHash),
  ])
  if (compareBytes(accountProofValueRlp as Uint8Array, accounValueRlp)) {
    throw new Error("Account proof verification failed.")
  }

  const storageTrie = new Trie({ useKeyHashing: true })
  const storageProofValueRlp = await storageTrie.verifyProof(
    hexToBytes(storageHash),
    hexToBytes(storageKey),
    storageProof[0].proof.map(hexToBytes),
  )
  if (compareBytes(RLP.decode(storageProofValueRlp) as Uint8Array, hexToBytes(storageProof[0].value))) {
    throw new Error("Storage proof verification failed.")
  }

  return {
    accountProof,
    storageProof,
    accountProofRlp: RLP.encode(accountProof.map((_part: string) => RLP.decode(_part))),
    blockHeaderRlp,
    storageProofRlp: RLP.encode(storageProof[0].proof.map((_part: string) => RLP.decode(_part))),
  }
}

export { getRlpEncodedBlockHeaderByBlockNumber, rlpEncodeBlock, getBlock }
