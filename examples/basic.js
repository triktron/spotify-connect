var connect = require("../lib/index.js");

var client = new connect({
  auth: {
    key: 'ADD KEY HERE',
    secret: 'ADD SECRET HERE',
    refresh_token: 'ADD REFRESH TOKEN HERE'
  },
  open: () => console.log("connected"),
  device_added: () => console.log("device added")
})

client.start()
