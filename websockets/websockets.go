// Package websockets manages active websocket connections and messages received
// from and sent to them
package websockets

// #include "bindings.h"
// #include <stdlib.h>
import "C"
import (
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"reflect"
	"sync"
	"unsafe"

	"github.com/bakape/meguca/auth"
	"github.com/bakape/meguca/common"
	"github.com/go-playground/log"
	"nhooyr.io/websocket"
)

// Client registry for binding with Rust. Needed, because Go pointers can
// not be stored in Rust.
var (
	clientsMu       sync.RWMutex
	clients         = make(map[uint64]client)
	clientIdCounter = uint64(0)

	errNonBinary = errors.New("non-binary message received")
)

// Client stores and manages a websocket-connected remote client and its
// interaction with the server and database
type client struct {
	// Remote IP of client
	ip net.IP

	// Used to receive from the client.
	//
	// To prevent infinite blocking all sends to this channel must be done in
	// a select including a <-ctx.Done() case.
	receive chan []byte

	// Used to send messages to the client.
	//
	// To prevent infinite blocking all sends to this channel must be done in
	// a select including a <-ctx.Done() case.
	send chan C.WSRcBuffer

	// Forcefully disconnect client with optional error.
	//
	// To prevent infinite blocking all sends to this channel must be done in
	// a select including a <-ctx.Done() case.
	close chan error

	// Context of the client build from context of upgrade request.
	// Needed to ensure resource deallocation in all scenarios.
	ctx context.Context
}

// http.HandleFunc that responds to new websocket connection requests
func Handle(w http.ResponseWriter, r *http.Request) (loopStarted bool, err error) {
	// Prevent websocket close errors from leaving module
	defer func() {
		_err := err
		for _err != nil {
			_, ok := _err.(websocket.CloseError)
			if ok {
				err = nil
				break
			}
			_err = errors.Unwrap(_err)
		}
	}()

	ip, err := auth.GetIP(r)
	if err != nil {
		return
	}

	// TODO: Handle globally banned clients
	// // Prevents connection spam
	// err = db.IsBanned("all", ip)
	// if err != nil {
	// 	return
	// }

	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	c := client{
		// This channel passes a reference-counted pointer from the Rust side.
		// Said pointer must be unreferenced at all scenarios, thus there can
		// not exist an ownership uncertainty over this pointer.
		// To ensure atomic ownership passage the channel can not be buffering.
		// Failure to do so intoduces a race between the sender and receiver
		// goroutine, which can result in the pointer never being unreferenced
		// and thus leaked.
		send: make(chan C.WSRcBuffer),

		close:   make(chan error),
		receive: make(chan []byte),
		ip:      ip,
	}

	var cancel context.CancelFunc
	c.ctx, cancel = context.WithCancel(r.Context())
	defer cancel()

	id, err := register(c)
	// Client is registered on the Go side even in case of error and thus must
	// be unregistered
	defer unregister(id)
	if err != nil {
		return
	}

	go func() {
		var (
			w   bytes.Buffer
			typ websocket.MessageType
			r   io.Reader
			err error
		)
		for {
			typ, r, err = conn.Reader(c.ctx)
			if err != nil {
				goto fail
			}
			if typ != websocket.MessageBinary {
				err = errNonBinary
				goto fail
			}

			w.Reset()
			_, err = io.Copy(&w, r)
			if err != nil {
				goto fail
			}

			// Synchronously pass message to Rust
			C.ws_receive_message(C.uint64_t(id), toWSBuffer(w.Bytes()))
		}

	fail:
		select {
		case <-c.ctx.Done():
		case c.close <- err:
		}
	}()

	loopStarted = true
	for {
		select {
		case <-c.ctx.Done():
			return
		case err = <-c.close:
			if err != nil {
				if !common.CanIgnoreClientError(err) {
					log.Errorf("websockets: by %s: %s: %#v", c.ip, err, err)
				}

				s := err.Error()
				if len(s) > 125 { // Max close message length
					s = s[:125]
				}
				// Ignore the close error. We can't always assert, if the client
				// actually receives the close message.
				conn.Close(websocket.StatusProtocolError, s)
			}
			return
		case msg := <-c.send:
			err = conn.Write(
				c.ctx,
				websocket.MessageBinary,
				toSlice(msg.inner.data, msg.inner.size),
			)
			C.ws_unref_message(msg.src)
			if err != nil {
				return
			}
		}
	}
}

// Register client and return its ID
func register(c client) (id uint64, err error) {
	// Not using deferred unlock to prevent possible deadlocks between the Go
	// and Rust client collection mutexes. These must be freed as soon as
	// possible.
	clientsMu.Lock()

	// Account for counter overflow
try:
	clientIdCounter++
	id = clientIdCounter
	_, ok := clients[id]
	if ok {
		goto try
	}
	clients[id] = c
	clientsMu.Unlock()

	// Zero copy string passing
	ip := c.ip.String()
	h := (*reflect.StringHeader)(unsafe.Pointer(&ip))
	err = fromCError(C.ws_register_client(
		C.uint64_t(id),
		C.WSBuffer{
			(*C.uint8_t)(unsafe.Pointer(h.Data)),
			C.size_t(h.Len),
		},
	))
	return
}

// Unregister client by ID
func unregister(id uint64) {
	// Not using deferred unlock to prevent possible deadlocks between the Go
	// and Rust client collection mutexes. These must be freed as soon as
	// possible.
	clientsMu.Lock()

	_, ok := clients[id]
	if ok {
		// Must be only place a client can be deleted from the map to prevent
		// state (including mutex state) branching.
		delete(clients, id)
		clientsMu.Unlock()

		C.ws_unregister_client(C.uint64_t(id))
	} else {
		clientsMu.Unlock()
	}
}
