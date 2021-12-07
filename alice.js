const axios = require('axios')
const bitcoinjs = require('bitcoinjs-lib')
const bip65 = require('bip65')

// Dogecoin JSON RPC token
const token = Buffer.from('satoshi:amiens', 'utf8').toString('base64')

// Initialize Dogecoin testnet info
bitcoinjs.networks.dogecoin_regtest = {
  messagePrefix: '\x18Dogecoin Signed Message:\n',
  bech32: 'tdge',
  bip32: {
    public: 0x0432a9a8,
    private: 0x0432a243
  },
  pubKeyHash: 0x6f,
  scriptHash: 0xc4,
  wif: 0xef,
}

function finalScriptsFunc (inputIndex, input, script, isSegwit, isP2SH, isP2WSH) {
  return { 
      finalScriptSig: bitcoinjs.script.fromASM('OP_0 ' + input.partialSig[0].signature.toString('hex') + ' ' + input.partialSig[1].signature.toString('hex') + ' OP_0 ' + bitcoinjs.script.fromASM(multisigScript).toString('hex')),
      finalScriptWitness: null,
  }
}

function jsonRPC (command, params) {
	return axios.post('http://127.0.0.1:18443', {
		jsonrpc: '1.0',
		id: 'wow',
		method: command, 
		params: params
	}, {
    headers: {
      'Authorization': `Basic ${token}`,
      'Content-Type': 'application/json'
    },
  })
}

async function jsonREST (method, url, data) {
	return await axios({
    method: method,
    url: `http://localhost:5000/api/v1/${url}`,
    data: data
  })
}

async function main () {
  console.log('Generate 150 blocks')

	result = await jsonRPC('generate', [150])

  // Generate Alice key pair from private key
  const keyPairA = bitcoinjs.ECPair.fromPrivateKey(Buffer.from('3b187fd3a10960efe5753c9851c174c05bcdb30db22fd9deab981fe1f0ec7b00', 'hex'))
  keyPairA.network = bitcoinjs.networks.dogecoin_regtest

  // Fill Alice wallet with some regtest coins
  const Alice = bitcoinjs.payments.p2pkh({ pubkey: keyPairA.publicKey, network: bitcoinjs.networks.dogecoin_regtest})
  console.log(`Alice address : ${Alice.address}`)

  // Send some funds to Alice
  console.log('Send 150 Doges to Alice')
  result = await jsonRPC('sendtoaddress', [Alice.address, 150])
  const txid = result.data.result

  console.log('Generate 50 blocks')
	result = await jsonRPC('generate', [50])

  /*
      Start Payment Channel
  */

  console.log('Create multisig p2sh address')

  const locktime = Buffer.from(bip65.encode({ blocks: 300 }).toString(16), 'hex').reverse().toString('hex')

  result = await jsonREST('get', 'pubkey/new')
  // keyPairB = {
  //   publicKey: Buffer.from(result.data.pubkey, 'hex')
  // }
  // console.log(keyPairB.publicKey)
  console.log('keyPairB', Buffer.from(result.data.pubkey, 'hex'))
  const uncompressedHex = bitcoinjs.ECPair.fromPublicKey(
    Buffer.from(result.data.pubkey, 'hex'),
    { compressed: true },
  ).publicKey.toString('hex')
  console.log(uncompressedHex)
  multisigScript = "OP_IF " + 
      locktime + "00" + " OP_CHECKLOCKTIMEVERIFY OP_DROP " +
      keyPairA.publicKey.toString('hex') + " OP_CHECKSIGVERIFY OP_ELSE OP_2 OP_ENDIF " +
      keyPairA.publicKey.toString('hex') + " " + uncompressedHex + " OP_2 OP_CHECKMULTISIG"
    
  const p2sh = bitcoinjs.payments.p2sh({
      redeem: { output: bitcoinjs.script.fromASM(multisigScript) },
      network: bitcoinjs.networks.dogecoin_regtest
  })

  console.log(`P2SH address : ${p2sh.address}`)

  // Create initial transaction that funds a multisig
	result = await jsonRPC('getrawtransaction', [txid])
console.log('result: ', result)
  let transaction = await jsonRPC('decoderawtransaction', [result.data.result])
  let index = 0
  transaction.data.result.vout.map(function (output) {
    if (output.scriptPubKey.addresses.includes(Alice.address)) {
      index = output.n
    }
  })

  const psbt = new bitcoinjs.Psbt()
  psbt.addInput({
    // if hash is string, txid, if hash is Buffer, is reversed compared to txid
    hash: txid,
    index: index,
    // non-segwit inputs now require passing the whole previous tx as Buffer
    nonWitnessUtxo: Buffer.from(result.data.result, 'hex')
  })

  psbt.addOutputs([{
    script: bitcoinjs.script.fromASM('OP_HASH160 ' + p2sh.hash.toString('hex') + ' OP_EQUAL'),
    value: 100*100000000
  }])

  psbt.signInput(0, keyPairA)
  psbt.finalizeAllInputs()

  const transactionMultisig = psbt.extractTransaction(true).toHex()

  console.log('Send some money to alice')
  result = await jsonRPC('sendrawtransaction', [transactionMultisig])
  const txidMultisig = result.data.result

  console.log('Generate 50 blocks')
	result = await jsonRPC('generate', [50])

  /*
    Create ready to be broadcast transaction as payment (but don't broadcast them!)
  */

  // Alice: 89, Bob: 10, fee: 1
  let psbt2 = new bitcoinjs.Psbt()
  // get raw transaction
	result = await jsonRPC('getrawtransaction', [txidMultisig])
  let tx2 = result.data.result
  psbt2.addInput({
    // if hash is string, txid, if hash is Buffer, is reversed compared to txid
    hash: txidMultisig,
    index: 0,
    // non-segwit inputs now require passing the whole previous tx as Buffer
    nonWitnessUtxo: Buffer.from(tx2, 'hex'),
    redeemScript: bitcoinjs.script.fromASM(multisigScript)
  })

  psbt2.addOutputs([{
    address: bitcoinjs.payments.p2pkh({ pubkey: keyPairA.publicKey }).address,
    value: 89*100000000
}, {
    address: bitcoinjs.payments.p2pkh({ pubkey: Buffer.from(uncompressedHex, 'hex') }).address,
    value: 10*100000000
}])

psbt2.signInput(0, keyPairA)
  let data = {
    "type": "announce",
    "ref": undefined,
    "psbt": psbt2.toHex()
  }

  result = await jsonREST('post', 'payment', data)
  console.log(result)
  console.log(result.data.psbt)
  console.log(result.data.psbtVdn.status)
  psbt2 = bitcoinjs.Psbt.fromHex(result.data.psbt)

  psbt2.finalizeInput(0, finalScriptsFunc)

  console.log('FIRST PAYMENT DONE!')

  /*
    Create second payment (and broadcast it to close payment channel)
  */
  console.log(psbt2.data.toHex())
  // Alice: 79, Bob: 20, fee: 1
  let psbt3 = new bitcoinjs.Psbt()
  psbt3.addInput({
    // if hash is string, txid, if hash is Buffer, is reversed compared to txid
    hash: txidMultisig,
    index: 0,
    // non-segwit inputs now require passing the whole previous tx as Buffer
    nonWitnessUtxo: Buffer.from(tx2, 'hex'),
    redeemScript: bitcoinjs.script.fromASM(multisigScript)
  })

  psbt3.addOutputs([{
      address: bitcoinjs.payments.p2pkh({ pubkey: keyPairA.publicKey }).address,
      value: 79*100000000
  }, {
      address: bitcoinjs.payments.p2pkh({ pubkey: Buffer.from(uncompressedHex, 'hex') }).address,
      value: 20*100000000
  }])

  psbt3.signInput(0, keyPairA)
  data = {
    "type": "announce",
    "ref": undefined,
    "psbt": psbt3.toHex()
  }

  result = await jsonREST('post', 'payment', data)
  console.log(result)
  console.log(result.data.psbt)
  console.log(result.data.psbtVdn.status)
  psbt3 = bitcoinjs.Psbt.fromHex(result.data.psbt)

  psbt3.finalizeInput(0, finalScriptsFunc)

  const finalTransaction = psbt3.extractTransaction(true).toHex()
  console.log(finalTransaction)
  await jsonRPC('sendrawtransaction', [finalTransaction])

  console.log('PAYMENT CHANNEL CLOSE!')

	// await container.stop()
  // await container.remove()

	// console.log('container stop')
}

main()