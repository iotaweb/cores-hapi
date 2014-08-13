var Util = require('util');
var Hapi = require('hapi');


module.exports = {

  debug: false,

  ACTIONS: {
    loadOwn: 'loadOwn',  
    load: 'load',
    createOwn: 'createOwn',
    create: 'create',
    updateOwn: 'updateOwn',
    update: 'update',
    destroyOwn: 'destroyOwn',
    destroy: 'destroy',
    view: 'view',
    search: 'search',
    schema: 'schema'
  },


  //
  // Create a custom error when there are validation errors
  //
  createError: function(err) {

    if (err.isBoom && !this.debug) {
      return err;
    }

    var e = Hapi.error.badRequest(err.message);
    // try to infer status code from err, use 500 when it is not present or not a number
    e.output.statusCode = err.code || err.status_code || err.statusCode || 500;
    if (isNaN(e.output.statusCode)) {
      e.output.statusCode = 500;
    }
    e.reformat();
    e.output.payload.errors = err.errors;
    err = e;

    if (this.debug) {
      err.output.stack = e.stack;
    }
    return err;
  },


  //
  // try parsing query parameters as json
  //
  parseQuery: function(query) {
    query = query || {};
    var q = {};
    for (var x in query) {
      try {
        q[x] = JSON.parse(query[x]);
      }
      catch(e) {
        q[x] = query[x];
      }
    }
    return q;
  }
};