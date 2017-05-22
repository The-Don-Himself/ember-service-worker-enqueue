# ember-service-worker-enqueue
An Ember Service Worker plugin that catches failed mutation requests e.g POST, PUT, DELETE and queues them for background processing.

It uses Mozilla’s localforage db wrapper to enqueue mutation requests that failed either because of a failed network e.g Flacky networks or Offline mode, or server errors to perform the operations once the connection is regained and/or periodically until it succeeds.

Currently, many configuration options are hard-coded e.g expected location of localforage.min.js but I'll update it soon.

Enjoy!