/*eslint-env es6 */
/*eslint no-unused-vars: 0 */
/*global importScripts, localforage */
importScripts('/localforage.min.js');

//Heavily inspired and borrowed from https://serviceworke.rs/request-deferrer_service-worker_doc.html with a few changes to add re-queueing features, server error checking and periodic flushing.

//By using Mozilla's localforage db wrapper, we can count on
//a fast setup for a versatile key-value database. We use
//it to store queue of deferred requests.

//Enqueue consists of adding a request to the list. Due to the
//limitations of IndexedDB, Request and Response objects can not
//be saved so we need an alternative representations. This is
//why we call to `serialize()`.`
function enqueue(request) {
  return serialize(request).then(serialized => {
    localforage.getItem('queue').then(queue => {
            /*eslint no-param-reassign: 0 */
      queue = queue || [];
      queue.push(serialized);

      return localforage.setItem('queue', queue).then(() => {
        console.log(serialized.method, serialized.url, 'enqueued!');
      });
    });
  });
}

//Flush is a little more complicated. It consists of getting
//the elements of the queue in order and sending each one,
//keeping track of not yet sent request. Before sending a request
//we need to recreate it from the alternative representation
//stored in IndexedDB.
function flushQueue() {
    //Get the queue
  return localforage.getItem('queue').then(queue => {
        /*eslint no-param-reassign: 0 */
    queue = queue || [];

        //If empty, nothing to do!
    if (!queue.length) {
      return Promise.resolve();
    }

    return localforage.setItem('tmpqueue', queue).then(() => localforage.setItem('queue', []).then(() => {
                //Else, send the requests in order...
      console.log('Sending ', queue.length, ' requests...');

      return sendInOrder(queue).then(() =>
                    //**Requires error handling**. Actually, this is assuming all the requests
                    //in queue are a success when reaching the Network. So it should empty the
                    //queue step by step, only popping from the queue if the request completes
                    //with success.
                   localforage.setItem('tmpqueue', []));
    }));
  });
}

//Send the requests inside the queue in order. Waiting for the current before
//sending the next one.
function sendInOrder(requests) {
    //The `reduce()` chains one promise per serialized request, not allowing to
    //progress to the next one until completing the current.
  const sending = requests.reduce((prevPromise, serialized) => {
    console.log('Sending', serialized.method, serialized.url);

    return prevPromise.then(() => deserialize(serialized).then(request => fetchClone(request).then(response => {
      if (response.status >= 500) {
        return enqueue(request).then(() => {

        });
      }
      if (response.status >= 400) {
        return;
      }

      return response.json().then(data => {
        const messageObject = {
          enqueue: true,
          url: request.url,
          json: data
        };

                        //Retrieve a list of the clients of this service worker.
        self.clients.matchAll().then(clientList => {
                            //Check if there's at least one focused client.
          const focused = clientList.some(client => client.focused);

          let notificationMessage;

          if (focused) {
                                //We are on one tab with site open
            focused.postMessage(messageObject);
          } else if (clientList.length > 0) {
                                //We have at least one tab open although not focused
      clientList[0].postMessage(messageObject);
    } else {
                                //No tab open do nothing
    }
        });
      });
    }).catch(error => enqueue(request).then(() => {

    }))));
  }, Promise.resolve());

  return sending;
}

//Serialize is a little bit convolved due to headers is not a simple object.
function serialize(request) {
  const headers = {};
    //`for(... of ...)` is ES6 notation but current browsers supporting SW, support this
    //notation as well and this is the only way of retrieving all the headers.

  for (const entry of request.headers.entries()) {
    headers[entry[0]] = entry[1];
  }
  const serialized = {
    url: request.url,
    headers,
    method: request.method,
    mode: request.mode || 'no-cors',
    credentials: request.credentials || 'include',
    cache: request.cache || 'default',
    redirect: request.redirect,
    referrer: request.referrer
  };

    //Only if method is not `GET` or `HEAD` is the request allowed to have body.
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return request.clone().text().then(body => {
      serialized.body = body;

      return Promise.resolve(serialized);
    });
  }

  return Promise.resolve(serialized);
}

//Compared, deserialize is pretty simple.
function deserialize(data) {
  return Promise.resolve(new Request(data.url, data));
}

function fetchClone(request) {
  return serialize(request).then(serialized =>
        //Modify serialized.body here to add your request parameter
       deserialize(serialized).then(req => fetch(req)));
}

self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method === 'GET' || request.method === 'HEAD') {
        //This addon is only meant to handle mutation requests
    return;
  }

  event.respondWith(
        fetchClone(request).then(response => {
          if (response.status >= 500) {
            return enqueue(request).then(() => new Response(JSON.stringify({}), {
              status: 202,
              headers: {'Content-Type': 'application/json'}
            }));
          }

          return response;
        }).catch(error => enqueue(request).then(() => new Response(JSON.stringify({}), {
          status: 202,
          headers: {'Content-Type': 'application/json'}
        })))
    );
});

self.addEventListener('message', event => {
  const message = event.data;
  const online = message.online;

  if (online) {
    console.log('Network available! Flushing queue.');
    event.waitUntil(flushQueue());
  }
});

setInterval(() => {
    //If online, flush queue every so often, in this case 1 minute.
  if (navigator.onLine) {
    console.log('Periodic Flushing of Queue');
    flushQueue();
  }
}, 1 * 60 * 1000
);
