# Dogecoin payment channel

This is an example repository to help in the implementation of an **unidirectional** payment channel.

The script will start a dogecoind regtest node inside a docker container. Initiate a payment channel using a p2sh multisig. Sign 2 payments. Close the payment channel by broadcasting the final transaction.

## Dev

```
$ npm install
$ npm start
```

## NOTES

`index.old.js` was a first draft.

first step is basically GET pubkey
then 2nd step is response
so after this alice needs to tell bob "hey i funded a p2sh with amount x"
i think this can be a psbt
https://github.com/rllola/doge-payment-channel/blob/a70dae06a84ed036fc1f3cbab7836a8d41eae457/index.old.js#L52-L65
so you'd accept that on your endpoint (you anyway need to accept these)
and if there are no outputs, then it means its the announcement of a new channel
https://github.com/rllola/doge-payment-channel/blob/a70dae06a84ed036fc1f3cbab7836a8d41eae457/index.js#L166-L173 this one in the index.js
need a little envelope around the psbt I think
so for example: POST /payment
{
  "type": "announce",
  "ref": undefined,
  "psbt": "hexstring"
}
then you code a controller that:
1. parses the json
2. based on the type, routes to a service:
  - "announce" => PCAnnounceService or something
3. implement PCAnnounceService to take the message object and
  - decode pbst
after that we implement some checks
and then we store that shit
lmk if thats doable