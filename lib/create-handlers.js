var Util = require('util');
var Hapi = require('hapi');
var Q = require('kew');
var Common = require('./common.js');


var ACTIONS = Common.ACTIONS;


//
// Get the doc from the payload and set isMultipart when multipart data
//
function parseSavePayload(resource, request) {

  var payload = request.payload;
  var contentType = request.raw.req.headers['content-type'];

  if (contentType && contentType.indexOf('multipart/form-data') !== -1) {
    if (typeof payload.doc === 'string') {
      payload.doc = JSON.parse(payload.doc);
    }
    payload.doc.type_ = resource.name;
    payload.isMultipart = true;
  }
  // enforce type
  payload.type_ = resource.name;

  return payload;
}


//
// create the route handlers
//
module.exports = function createHandlers(resource, pre, post, permissions) {

  return {

    getSchema: function(request, reply) {
      permissions.check(ACTIONS.schema, resource, request).then(function() {
        reply(resource.schema.toJSON());

      }).fail(function(err) {
        reply(Common.createError(err));
      });
    },


    getById: function(request, reply) {

      permissions.check(ACTIONS.loadOwn, resource, request).then(function() {
        return pre.handle(ACTIONS.loadOwn, resource, request);

      }).then(function() {
        return resource.load(request.params.id);

      }).then(function(doc) {
        return permissions.checkOwnership(ACTIONS.loadOwn, resource, request, doc);
          
      }).then(function(doc) {
        if (request.query.include_refs !== 'true') {
          return doc;
        }
        return resource.cores.fetchRefs(doc);

      }).then(function(doc) {
        return post.handle(ACTIONS.loadOwn, resource, request, doc);

      }).then(function(doc) {
        reply(doc);

      }).fail(function(err) {
      
          // anonymous user or 
          // authorised user with no loadOwn rights or
          // doc with no userKey      

          permissions.check(ACTIONS.load, resource, request).then(function() {
            return pre.handle(ACTIONS.load, resource, request);
    
          }).then(function() {
            return resource.load(request.params.id);
    
          }).then(function(doc) {
            if (request.query.include_refs !== 'true') {
              return doc;
            }
            return resource.cores.fetchRefs(doc);
    
          }).then(function(doc) {
            return post.handle(ACTIONS.load, resource, request, doc);
    
          }).then(function(doc) {
            reply(doc);
    
          }).fail(function(err) {
            reply(Common.createError(err));
          });
        
      });
    },


    getView: function(viewName) {
      return function(request, reply) {

        permissions.check(ACTIONS.view, resource, request).then(function() {
          return pre.handle(ACTIONS.view, resource, request);

        }).then(function() {
          return resource.view(viewName, request.query);

        }).then(function(result) {
          if (request.query.include_refs !== 'true') {
            return result;
          }
          // use included docs or row values
          var docs = request.query.include_docs === 'true'
                ? result.rows.map(function(row) { return row.doc; })
                : result.rows.map(function(row) { return row.value; });

          return resource.cores.fetchRefs(docs).then(function(docs) {
            // return view result instead of docs array,
            // docs array contains references to the rows docs in the result
            return result;
          });

        }).then(function(result) {
          return post.handle(ACTIONS.view, resource, request, result);

        }).then(function(result) {
          reply(result);

        }).fail(function(err) {
          reply(Common.createError(err));
        });
      };
    },


    getSearch: function(indexName) {
      return function(request, reply) {
        permissions.check(ACTIONS.search, resource, request).then(function() {
          return pre.handle(ACTIONS.search, resource, request);

        }).then(function() {
          return resource.search(indexName, request.query);

        }).then(function(result) {
          return post.handle(ACTIONS.search, resource, request, result);

        }).then(function(result) {
          reply(result);

        }).fail(function(err) {
          reply(Common.createError(err));
        });
      };
    },


    save: function(request, reply) {
      var doc = parseSavePayload(resource, request);

      permissions.check(ACTIONS.createOwn, resource, request).then(function() {
        return pre.handle(ACTIONS.createOwn, resource, request, doc);
        
      }).then(function(doc) {
        return permissions.checkOwnership(ACTIONS.createOwn, resource, request, doc);

      }).then(function(doc) {
        return resource.save(doc);

      }).then(function(doc) {
        return post.handle(ACTIONS.createOwn, resource, request, doc);

      }).then(function(doc) {
        reply(doc);

      }).fail(function(err) {
      
          // anonymous user or 
          // authorised user with no createOwn rights or
          // doc with no userKey      

          permissions.check(ACTIONS.create, resource, request).then(function() {
            return pre.handle(ACTIONS.create, resource, request, doc);
    
          }).then(function(doc) {
            return resource.save(doc);
    
          }).then(function(doc) {
            return post.handle(ACTIONS.create, resource, request, doc);
    
          }).then(function(doc) {
            reply(doc);
    
          }).fail(function(err) {
            return reply(Common.createError(err));
          });

      });
    },


    saveWithId: function(request, reply) {
      var doc = parseSavePayload(resource, request);
      if (doc._rev) {
        // prevent update, updates should put to /{id}/{rev}
        var err = new Error('Doc with _rev not allowed');
        err.code = 400;
        throw err;
      }
      doc._id = request.params.id;

      permissions.check(ACTIONS.createOwn, resource, request).then(function() {
        return pre.handle(ACTIONS.createOwn, resource, request, doc);

      }).then(function(doc) {
        return permissions.checkOwnership(ACTIONS.createOwn, resource, request, doc);

      }).then(function(doc) {
        return resource.save(doc);

      }).then(function(doc) {
        return post.handle(ACTIONS.createOwn, resource, request, doc);

      }).then(function(doc) {
        reply(doc);

      }).fail(function(err) {
      
         // anonymous user or 
         // authorised user with no createOwn rights or
         // doc with no userKey      

          permissions.check(ACTIONS.create, resource, request).then(function() {
            return pre.handle(ACTIONS.create, resource, request, doc);
    
          }).then(function(doc) {
            return resource.save(doc);
    
          }).then(function(doc) {
            return post.handle(ACTIONS.create, resource, request, doc);
    
          }).then(function(doc) {
            reply(doc);
    
          }).fail(function(err) {
            reply(Common.createError(err));
          });

      });
    },


    update: function(request, reply) {
      var doc = parseSavePayload(resource, request);
      doc._id = request.params.id;
      doc._rev = request.params.rev;

      permissions.check(ACTIONS.updateOwn, resource, request).then(function() {
        return pre.handle(ACTIONS.updateOwn, resource, request, doc);
      
      }).then(function(doc) {
        return permissions.checkOwnership(ACTIONS.updateOwn, resource, request, doc);

      }).then(function(doc) {
        return resource.save(doc);

      }).then(function(doc) {
        return post.handle(ACTIONS.updateOwn, resource, request, doc);

      }).then(function(doc) {
        reply(doc);

      }).fail(function(err) {

         // anonymous user or 
         // authorised user with no updateOwn rights or
         // doc with no userKey

          permissions.check(ACTIONS.update, resource, request).then(function() {
            return pre.handle(ACTIONS.update, resource, request, doc);
    
          }).then(function(doc) {
            return resource.save(doc);
    
          }).then(function(doc) {
            return post.handle(ACTIONS.update, resource, request, doc);
    
          }).then(function(doc) {
            reply(doc);
    
          }).fail(function(err) {
            reply(Common.createError(err));
          });
      
      });
    },


    destroy: function(request, reply) {
      var doc = {
        type_: resource.name,
        _id: request.params.id
      };
      
      // TODO destroyOwn operates twice for some reason from Pages list view causing
      // redirect to login page instead of reload of current view - need to fix

      permissions.check(ACTIONS.destroyOwn, resource, request).then(function() {      
        return pre.handle(ACTIONS.destroyOwn, resource, request, doc);
             
      }).then(function() {
        return resource.load(request.params.id);

      }).then(function(doc) {
        return permissions.checkOwnership(ACTIONS.destroyOwn, resource, request, doc);

      }).then(function() {     
        return resource.destroy(doc);

      }).then(function() {     
        return post.handle(ACTIONS.destroyOwn, resource, request, doc);

      }).then(function() {
        reply();

      }).fail(function(err) {
      
          // anonymous user or 
          // authorised user with no deleteOwn rights or
          // doc with no userKey      

          permissions.check(ACTIONS.destroy, resource, request).then(function() {
            return pre.handle(ACTIONS.destroy, resource, request, doc);
    
          }).then(function() {
            return resource.destroy(doc);
    
          }).then(function() {
            return post.handle(ACTIONS.destroy, resource, request, doc);
    
          }).then(function() {
            reply();
    
          }).fail(function(err) {
            reply(Common.createError(err));
          });

      });
    }
  };
};
