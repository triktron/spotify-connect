'use strict'
const VirtualClock = require('virtual-clock').default

class Track {
   /**
    * @param {Object} [opts] - Setup custom's endpoints
    */
   constructor(opts) {
     this.name = opts && opts.name ? opts.name : ''
     this.duration = opts && opts.duration ? opts.duration : 0
     this.paused = opts && opts.paused ? opts.paused : true
     this.authors = []

     this.timer = new VirtualClock()
     if (!this.paused) this.timer.start()
   }

   isPaused() {
     return this.paused
   }
   pause() {
     this.timer.stop()
   }
   resume() {
     this.timer.start()
   }
   getPosition() {
     return this.timer.time
   }
   setPosition(milis) {
     return this.timer.time = milis
   }
   getDuration() {
     return this.duration;
   }
}

module.exports = Track
