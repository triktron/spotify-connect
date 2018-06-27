'use strict'

const request = require('request-promise')
const Promise = require('bluebird')
const WebSocket = require('ws');
const localStorageExp = require('./localStorageExp')
const Track = require('./track');

class Connect {
   /**
    * @param {Object} [opts] - Setup custom's endpoints
    */
   constructor(opts) {
      this.baseURL = opts && opts.url ? opts.url : 'https://api.spotify.com/v1'
      this.authURL = opts && opts.authURL ? opts.authURL : 'https://accounts.spotify.com/api/token'
      this.name = opts && opts.name ? opts.name : 'Spotify Connect JS'
      this.auth = opts && opts.auth ? opts.auth : null
      this.open = opts && opts.open ? opts.open : function() {}
      this.device_added = opts && opts.device_added ? opts.device_added : function() {}
      this.state = {
         seq_num: 0,
         state_index: null,
         track_index: null,
         paused: true,
         machine_id: null,
         tracks: [],
         states: []
      }
      this.ws = null
      this.track = new Track()
      this.endpoints = {
         dealer: `https://apresolve.spotify.com/?type=dealer`,
         scope: `${this.baseURL}/melody/v1/check_scope?scope=streaming`,
         device: `${this.baseURL}/track-playback/v1/devices`,
         auth: this.authURL
      }
   }

   /**
    * @param {string} path - endpoint to send request
    * @param {Object} [params] - querystrings
    */

   getToken() {
      const token = localStorageExp.load('token')
      if (token) {
         return Promise.resolve(token)
      }

      if (!this.auth) {
         return Promise.reject('Client credentials are not provided')
      }

      const key = this.auth.key
      const secret = this.auth.secret
      const refresh_token = this.auth.refresh_token

      const encode = Buffer.from(`${key}:${secret}`).toString('base64')

      const opts = {
         method: 'POST',
         url: this.endpoints.auth,
         headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/66.0.3359.181 Safari/537.36',
            'authorization': `Basic ${encode}`,
            'content-type': 'application/x-www-form-urlencoded'
         },
         form: {
            grant_type: 'refresh_token',
            refresh_token: refresh_token
         },
         json: true
      }

      return Promise.resolve(request(opts).then((data) => {
         localStorageExp.save('token', data.access_token, 30)
         return data.access_token
      }))
   }

   getDeviceId() {
      var device_id = localStorageExp.load('device_id')
      if (device_id) {
         return Promise.resolve(device_id)
      }

      device_id = ""
      var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

      for (var i = 0; i < 40; i++)
         device_id += possible.charAt(Math.floor(Math.random() * possible.length))

      localStorageExp.save('device_id', device_id, 40000)
      return Promise.resolve(device_id)
   }

   checkScope() {
      return this.getToken()
         .then((token) => {
            const opts = {
               method: "GET",
               uri: this.endpoints.scope,
               headers: {
                  'Authorization': `Bearer ${token}`
               }
            }

            return Promise.resolve(request(opts))
         })
   }

   getDealer() {
      const opts = {
         method: 'GET',
         url: this.endpoints.dealer,
         json: true
      }

      return Promise.resolve(request(opts).then((data) => {
         return data.dealer[0]
      }))
   }

   start() {
      return new Promise((resolve, reject) => {
         Promise.all([this.getToken(), this.getDealer()])
            .then((data) => {
               this.ws = new WebSocket('wss://' + data[1] + '/?access_token=' + data[0]);
               this.ws.on('open', () => this._open(this))
               this.ws.on('message', (data) => this._message(this, data))
               resolve(this.ws);
            })
            .catch((err) => reject(new Error(err)))
      })
   }

   _open(self) {
      self.ws.send('{"type":"ping"}')
      setInterval(function() {
         self.ws.send('{"type":"ping"}')
      }, 30000)
      self.open()
   }

   _message(self, data) {
      data = JSON.parse(data)

      if (data.method == "PUT" && data.headers["Spotify-Connection-Id"]) {
         self["Spotify-Connection-Id"] = data.headers["Spotify-Connection-Id"];
         self.sendDevice(self).then(self.device_added)
      }

      if (data.payloads)
         for (var payload of data.payloads) {
            if (payload.type == "replace_state") {
               self._setState(self, payload)

               self.updateState(self)
            }
         }
   }

   _setState(self, payload) {
     console.log(payload.seek_to);
      if (payload.seek_to) {
        self.track.position = payload.seek_to;
        self.track.timer.time = payload.seek_to;
      }
      if (payload.state_machine) {
         if (payload.state_machine.tracks.length > 0) self.state.tracks = payload.state_machine.tracks.map(
            t => {
               return {
                  manifest: t.manifest,
                  authors: t.metadata.authors,
                  duration: t.metadata.duration,
                  images: t.metadata.images,
                  name: t.metadata.name,
                  uri: t.metadata.uri
               }
            })
         if (payload.state_machine.states.length > 0) self.state.states = payload.state_machine.states.map(
            t => {
               return {
                  id: t.state_id,
                  track: t.track
               }
            })
         self.state.machine_id = payload.state_machine.state_machine_id
      }
      if (payload.state_ref) {
         self.state.state_index = payload.state_ref.state_index
         self.state.track_index = self.state.states[self.state.state_index] ? self.state.states[self.state.state_index].track : null;
         self.state.paused = payload.state_ref.paused
      }

   }

   sendDevice(self) {
      return new Promise((resolve, reject) => {
         Promise.all([this.getToken(), this.getDeviceId()])
            .then((data) => {

               const opts = {
                  method: 'POST',
                  url: this.endpoints.device,
                  headers: {
                     'content-type': 'application/json',
                     'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/66.0.3359.181 Safari/537.36',
                     authorization: `Bearer ${data[0]}`
                  },
                  body: JSON.stringify({
                     "device": {
                        "device_id": data[1],
                        "device_type": "computer",
                        "brand": "spotify",
                        "model": "web_player",
                        "name": this.name,
                        "platform_identifier": "Partner spotify web_player",
                        "metadata": {
                           "disable_connect_api_compat": "true"
                        },
                        "capabilities": {
                           "change_volume": false,
                           "audio_podcasts": true,
                           "enable_play_token": true,
                           "stop_on_play_token_lost": false,
                           "disable_connect": false,
                           "manifest_formats": ["file_urls_mp3", "file_ids_mp4", "file_ids_mp4_dual"]
                        }
                     },
                     "connection_id": this["Spotify-Connection-Id"],
                     "client_version": "harmony:3.10.1-8f8af9e",
                     "previous_session_state": null,
                     "volume": 65535
                  })
               }

               resolve(request(opts).then((data) => {
                  self.state.seq_num = JSON.parse(data).initial_seq_num
                  resolve();
               }))
            })
      })
   }

   updateState(self) {
      return new Promise((resolve, reject) => {
         Promise.all([this.getToken(), this.getDeviceId()])
            .then((data) => {

               const opts = {
                  method: 'PUT',
                  url: 'https://api.spotify.com/v1/track-playback/v1/devices/' + data[1] + '/state',
                  headers: {
                     'content-type': 'application/json',
                     'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/66.0.3359.181 Safari/537.36',
                     'cache-control': 'no-cache',
                     authorization: `Bearer ${data[0]}`
                  },
                  body: JSON.stringify({
                     "seq_num": self.state.seq_num,
                     "state_ref": {
                        "state_machine_id": self.state.machine_id,
                        "state_id": self.state.states[self.state.state_index].id,
                        "paused": self.state.paused
                     },
                     "sub_state": {
                        "playback_speed": self.state.paused ? 0 : 1,
                        "position": Math.round(self.track.position)
                     },
                     "debug_source": "optimistic_replace_state"
                  })
               }

               resolve(request(opts).then((data) => {
                  data = JSON.parse(data)
                  if (data.updated_state_ref != null) data.state_ref = data.updated_state_ref;

                  self._setState(self, data);

                  self._updateTrack()
                  resolve();
               }))
            })
      })
   }

   _updateTrack() {
     if (!this.state) return;
     var track = this.state.tracks[this.state.track_index];
     if (track) {
        this.track.name = track.name
        this.track.authors = track.authors
        this.track.duration = track.duration
        this.track.paused = this.state.paused
        this.track.timer.running = !this.state.paused
     } else {
       this.track.name = ''
       this.track.authors = []
       this.track.position = 0
       this.track.duration = 0
       this.track.paused = true
       this.track.timer.running = false;
       this.track.timer.time = 0
     }
   }

   getName() {}
   setName() {}
   getVolume() {}
   setVolume() {}
   getTrack() {}
   getNextSong() {}
   nextSong() {}
   getPrevSong() {}
   prevSong() {}
   isConneced() {}
   connect() {}
   disconect() {}
   getModal() {}
   setModal() {}
}

module.exports = Connect
