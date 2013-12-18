/*global before after beforeEach afterEach describe it*/

var fs = require('fs');
var assert = require('assert');
var util = require('util');

var hapi = require('hapi');
var nano = require('nano')('http://localhost:5984');
var request = require('request');
var Q = require('kew');
var coresHapi = require('../index.js');
var ApiMiddleware = require('../lib/api-middleware.js');

var articleData = require('./article-data.js');
var imageData = require('./image-data.js');


function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}


describe('cores-hapi', function() {

  var dbName = 'test-cores-hapi';
  var cores, server;

  var startServer = function(apiOptions, callback) {
    server = new hapi.Server('127.0.0.1', 3333, {
      payload: {
        multipart: 'file'
      }
    });

    if (apiOptions.auth) {
      server.auth('basic', {
        scheme: 'basic',
        validateFunc: function(username, password, callback) {
          callback(new Error('Auth failed'));
        }
      });
    }

    var options = {
      db: 'http://localhost:5984/' + dbName,
      resourcesDir: __dirname,
      syncDesign: true,
      api: apiOptions
    };

    server.pack.require('../', options, function(err) {
      assert(!err);

      cores = server.pack.plugins['cores-hapi'].cores;

      server.start(function(err) {
        callback(err, server);
      });
    });
  };


  var stopServer = function(done) {
    server.stop(done);
  };


  before(function(done) {
    // setup test db
    nano.db.get(dbName, function(err, body) {
      if (!err) {
        // db exists, recreate
        nano.db.destroy(dbName, function(err) {
          if (err) done(err);
          nano.db.create(dbName, done);
        });
      }
      else if (err.reason === 'no_db_file'){
        // create the db
        nano.db.create(dbName, done);
      }
      else done(err);
    });
  });


  after(function(done) {
    nano.db.destroy(dbName, done);
  });


  describe('api', function() {

    var route = '/articles';
    var schemaRoute = '/articles/_schema';
    var viewRoute = '/articles/_views/titles';

    var docId = null;
    var doc2Id = null;
    var docRev = null;
    var uuid = null;

    var imageHandler = function(payload) {
      if (payload.isMultipart) {
        return Q.resolve(payload.doc);
      }
      else {
        return Q.resolve(payload);
      }
    };

    before(function(done) {
      startServer({}, function(err, server) {
        server.plugins['cores-hapi'].setHandler('create', 'Image', imageHandler);
        server.plugins['cores-hapi'].setHandler('update', 'Image', imageHandler);
        done();
      });
    });

    after(stopServer);


    it('should GET the index', function(done) {
      server.inject(
        { method: 'GET', url: '/_index' },
        function(res) {
          assert(res.statusCode === 200);
          assert(typeof res.result.Article === 'object');
          assert(res.result.Article.type === 'Article');
          assert(typeof res.result.Article.path === 'string');
          assert(typeof res.result.Article.viewPaths === 'object');
          assert(typeof res.result.Article.viewPaths.all === 'string');
          assert(typeof res.result.Article.schemaPath === 'string');
          assert(typeof res.result.Image === 'object');
          done();
        }
      );
    });

    it('should GET a uuid', function(done) {
      server.inject(
        { method: 'GET', url: '/_uuids' },
        function(res) {
          assert(res.statusCode === 200);
          assert(res.result.uuids.length === 1);

          uuid = res.result.uuids[0];

          done();
        }
      );
    });

    it('should GET multiple uuids', function(done) {
      server.inject(
        { method: 'GET', url: '/_uuids?count=5' },
        function(res) {
          assert(res.statusCode === 200);
          assert(res.result.uuids.length === 5);
          done();
        }
      );
    });

    it('should GET the schema', function(done) {
      server.inject(
        { method: 'GET', url: schemaRoute },
        function(res) {
          assert(res.statusCode === 200);
          assert(res.result.title === 'Article');
          done();
        }
      );
    });


    it('should POST', function(done) {
      server.inject(
        { method: 'POST', url: route, payload: JSON.stringify(articleData) },
        function(res) {
          assert(res.statusCode === 200);
          assert(res.result.type_ === 'Article');

          docId = res.result._id;
          docRev = res.result._rev;
          done();
        }
      );
    });


    it('should POST another doc', function(done) {
      var doc = clone(articleData);
      doc.other = { id_: docId };

      server.inject(
        { method: 'POST', url: route, payload: JSON.stringify(doc) },
        function(res) {
          assert(res.statusCode == 200);
          doc2Id = res.result._id;
          done();
        }
      );
    });


    it('should return errors when POST not validating', function(done) {
      server.inject(
        { method: 'POST', url: route, payload: JSON.stringify({title:42}) },
        function(res) {
          assert(res.statusCode === 400);
          assert(util.isArray(res.result.errors));
          done();
        }
      );
    });


    it('should POST multipart', function(done) {
      var file = fs.createReadStream(__dirname + '/test.jpg');

      var r = request.post('http://localhost:3333/images', function(err, res) {
        assert(!err);
        assert(res.statusCode === 200);

        var d = JSON.parse(res.body);
        assert(d.file === 'test.jpg');
        assert(typeof d._id === 'string');
        assert(typeof d._rev === 'string');
        assert(d.type_ === 'Image');

        done();
      });

      var form = r.form();
      form.append('doc', JSON.stringify(imageData));
      form.append('file', file);
    });


    it('should GET all', function(done) {
      server.inject(
        { method: 'GET', url: route },
        function(res) {
          assert(res.result.total_rows > 1);
          assert(res.result.rows.length > 1);
          done();
        }
      );
    });


    it('should GET all with params', function(done) {
      server.inject(
        { method: 'GET', url: route + '?limit=1' },
        function(res) {
          assert(res.result.total_rows > 1);
          assert(res.result.rows.length === 1);
          done();
        }
      );
    });


    it('should GET', function(done) {
      server.inject(
        { method: 'GET', url: route + '/' + docId },
        function(res) {
          assert(res.statusCode === 200);
          assert(res.result._id === docId);
          assert(res.result._rev === docRev);
          done();
        }
      );
    });


    it('should GET with included refs', function(done) {
      server.inject(
        { method: 'GET', url: route + '/' + doc2Id + '?include_refs=true' },
        function(res) {
          assert(res.statusCode === 200);
          assert(res.result.other._id === docId);
          done();
        }
      );
    });


    it('should not GET nonexistant', function(done) {
      server.inject(
        { method: 'GET', url: route + '/asdasd'},
        function(res) {
          assert(res.statusCode === 404);
          done();
        }
      );
    });


    it('should GET the view', function(done) {
      server.inject(
        { method: 'GET', url: viewRoute },
        function(res) {
          assert(res.statusCode === 200);
          assert(res.result.total_rows >= 2);
          done();
        }
      );
    });


    it('should GET the view with params', function(done) {
      server.inject(
        { method: 'GET', url: viewRoute + '?limit=1' },
        function(res) {
          assert(res.statusCode === 200);
          assert(res.result.rows.length === 1);
          done();
        }
      );
    });


    it('should GET the view with included refs', function(done) {
      var query = '?limit=1&keys=' + encodeURIComponent('["' + doc2Id + '"]') + '&include_docs=true&include_refs=true';
      server.inject(
        { method: 'GET', url: viewRoute + query},
        function(res) {
          assert(res.statusCode === 200);
          assert(res.result.rows[0].doc.other._id === docId);
          done();
        }
      );
    });


    it('should PUT with id', function(done) {
      server.inject(
        { method: 'PUT', url: route + '/' + uuid, payload: JSON.stringify(articleData) },
        function(res) {
          assert(res.statusCode === 200);

          var d = res.result;
          assert(d.type_ === 'Article');
          assert(d._id === uuid);
          done();
        }
      );
    });


    it('should PUT with id and rev', function(done) {
      server.inject(
        { method: 'PUT', url: route + '/' + docId + '/' + docRev, payload: JSON.stringify(articleData) },
        function(res) {
          assert(res.statusCode === 200);

          var d = res.result;
          assert(d.type_ === 'Article');
          assert(d._id === docId);
          assert(d._rev !== docRev);
          docRev = d._rev;
          done();
        }
      );
    });


    it('should return errors when PUT not validating', function(done) {
      server.inject(
        { method: 'PUT', url: route + '/' + docId + '/' + docRev, payload: JSON.stringify({title:42}) },
        function(res) {
          assert(res.statusCode === 400);
          assert(util.isArray(res.result.errors));
          done();
        }
      );
    });


    it('should PUT multipart', function(done) {
      var file = fs.createReadStream(__dirname + '/test.jpg');

      var r = request.put('http://localhost:3333/images/' + docId + '/' + docRev, function(err, res) {
        assert(!err);
        assert(res.statusCode === 200);

        var d = JSON.parse(res.body);
        assert(d.file === 'test.jpg');
        assert(typeof d._id === 'string');
        assert(typeof d._rev === 'string');
        assert(d.type_ === 'Image');

        done();
      });

      var form = r.form();
      form.append('doc', JSON.stringify(imageData));
      form.append('file', file);
    });


    it('should DELETE', function(done) {
      server.inject(
        { method: 'DELETE', url: route + '/' + docId + '/' + docRev },

        function(res) {
          assert(res.statusCode === 200);

          server.inject(
            { method: 'GET', url: route + '/' + docId },
            function(res) {
              assert(res.statusCode === 404);
              done();
            }
          );
        }
      );
    });


    it('should not DELETE nonexistant', function(done) {
      server.inject(
        { method: 'DELETE', url: route + '/' + docId + '/' + docRev},
        function(res) {
          assert(res.statusCode === 400);
          done();
        }
      );
    });
  });


  describe('permissions', function() {

    before(function(done) {
      startServer({ auth: true }, done);
    });

    after(stopServer);

    var authData = [
      { user: 'all', pass: 'all',
        permissions: { load: true, create: true, update: true, destroy: true, views: true }},
      { user: 'load', pass: 'load',
        permissions: { load: true, create: false, update: false, destroy: false, views: false }},
      { user: 'create', pass: 'create',
        permissions: { load: false, create: true, update: false, destroy: false, views: false }},
      { user: 'update', pass: 'update',
        permissions: { load: false, create: false, update: true, destroy: false, views: false }},
      { user: 'destroy', pass: 'destroy',
        permissions: { load: false, create: false, update: false, destroy: true, views: false }},
      { user: 'views', pass: 'views',
        permissions: { load: false, create: false, update: false, destroy: true, viewss: true }},
      { user: 'none', pass: 'none' }
    ];

    var createCredentials = function(permissions) {
      if (!permissions) {
        return { permissions: {} };
      }
      var ps = { permissions: { Article: {} } };
      for (var n in permissions) {
        ps.permissions.Article[n] = permissions[n];
      }
      return ps;
    };

    var articleId = 'auth_article';

    beforeEach(function(done) {
      // make sure dummy article exists
      cores.resources.Article.load(articleId).then(function() {
        done();
      }, function(err) {
        if (err.error === 'not_found') {
          var d = clone(articleData);
          d._id = articleId;
          cores.resources.Article.save(d).then(function(doc) {
            done();
          }, done);
        }
      });
    });


    authData.forEach(function(data) {

      var cred = createCredentials(data.permissions);
      var shouldLoad = data.permissions && data.permissions.load;
      var shouldView = data.permissions && data.permissions.views;
      var shouldCreate = data.permissions && data.permissions.create;
      var shouldUpdate = data.permissions && data.permissions.update;
      var shouldDestroy = data.permissions && data.permissions.destroy;

      describe(data.user, function() {

        it('should ' + (shouldLoad ? '' : 'not ') + 'load single', function(done) {
          server.inject(
            { method: 'GET', url: '/articles/' + articleId, credentials: cred },
            function(res) {
              if (shouldLoad) assert(res.statusCode === 200);
              else            assert(res.statusCode !== 200);
              done();
            }
          );
        });

        it('should ' + (shouldView ? '' : 'not ') + 'view all', function(done) {
          server.inject(
            { method: 'GET', url: '/articles', credentials: cred },
            function(res) {
              if (shouldView) assert(res.statusCode === 200);
              else            assert(res.statusCode !== 200);
              done();
            }
          );
        });

        it('should ' + (shouldView ? '' : 'not ') + 'call view', function(done) {
          server.inject(
            { method: 'GET', url: '/articles/_views/titles', credentials: cred },
            function(res) {
              if (shouldView) assert(res.statusCode === 200);
              else            assert(res.statusCode !== 200);
              done();
            }
          );
        });

        it('should ' + (shouldCreate ? '' : 'not ') + 'save', function(done) {
          var doc = clone(articleData);
          server.inject(
            { method: 'POST', url: '/articles',
              payload: JSON.stringify(doc),
              credentials: cred },
            function(res) {
              if (shouldCreate) assert(res.statusCode === 200);
              else              assert(res.statusCode !== 200);
              done();
            }
          );
        });

        it('should ' + (shouldCreate ? '' : 'not ') + 'save with id', function(done) {
          var doc = clone(articleData);
          server.inject(
            { method: 'PUT', url: '/articles/' + 'saved_' + (new Date().getTime()),
              payload: JSON.stringify(doc),
              credentials: cred },
            function(res) {
              if (shouldCreate) assert(res.statusCode === 200);
              else              assert(res.statusCode !== 200);
              done();
            }
          );
        });

        it('should ' + (shouldUpdate ? '' : 'not ') + 'update', function(done) {
          cores.resources.Article.load(articleId, function(err, doc) {
            assert(!err);

            doc.title = 'Hello Auth';
            server.inject(
              { method: 'PUT', url: '/articles/' + doc._id + '/' + doc._rev,
                payload: JSON.stringify(doc),
                credentials: cred },
              function(res) {
                if (shouldUpdate) assert(res.statusCode === 200);
                else              assert(res.statusCode !== 200);
                done();
              }
            );
          });
          cores.resources.Article.load(articleId).then(function(doc) {
            doc.title = 'Hello Auth';
            server.inject(
              { method: 'PUT', url: '/articles/' + doc._id + '/' + doc._rev,
                payload: JSON.stringify(doc),
                credentials: cred },
              function(res) {
                if (shouldUpdate) assert(res.statusCode === 200);
                else              assert(res.statusCode !== 200);
                done();
              }
            );
          }, done);
        });

        it('should ' + (shouldDestroy ? '' : 'not ') + 'destroy', function(done) {
          cores.resources.Article.load(articleId).then(function(doc) {
            server.inject(
              { method: 'DELETE', url: '/articles/' + doc._id + '/' + doc._rev, credentials: cred },
              function(res) {
                if (shouldDestroy) assert(res.statusCode === 200);
                else               assert(res.statusCode !== 200);
                done();
              }
            );
          }, done);
        });
      });
    });
  });


  describe('ApiMiddleware', function() {

    it('should pass on payload', function(done) {
      var md = new ApiMiddleware();
      md.handleAction('load', {}, { name: 'Foo' }, { data: 123 }).then(function(payload) {
        assert(payload.data === 123);
        done();
      }, done);
    });


    it('should call handler', function(done) {
      var md = new ApiMiddleware();

      md.setHandler('load', 'Foo', function(payload) {
        return { called: true };
      });

      md.handleAction('load', {}, { name: 'Foo' }, {}).then(function(payload) {
        assert(payload.called);
        done();
      }, done);
    });

    it('should call pre handler', function(done) {
      var md = new ApiMiddleware();

      md.setPreHandler('load', function(payload) {
        return { called: true };
      });
      md.handleAction('load', {}, { name: 'Foo' }, {}).then(function(payload) {
        assert(payload.called);
        done();
      }, done);
    });

    it('should call post handler', function(done) {
      var md = new ApiMiddleware();

      md.setPostHandler('load', function(payload) {
        return { called: true };
      });
      md.handleAction('load', {}, { name: 'Foo' }, {}).then(function(payload) {
        assert(payload.called);
        done();
      }, done);
    });

    it('should call handlers in order', function(done) {
      var md = new ApiMiddleware();

      md.setPreHandler('load', function(payload) {
        assert(payload.count === 0);
        return { count: payload.count + 1 };
      });
      md.setHandler('load', 'Foo', function(payload) {
        assert(payload.count === 1);
        return { count: payload.count + 1 };
      });
      md.setPostHandler('load', function(payload) {
        assert(payload.count === 2);
        return { count: payload.count + 1 };
      });

      md.handleAction('load', {}, { name: 'Foo' }, { count: 0 }).then(function(payload) {
        assert(payload.count === 3);
        done();
      }, done);
    });


    it('should propagate error', function(done) {
      var md = new ApiMiddleware();

      md.setHandler('load', 'Foo', function(payload) {
        throw new Error('foo');
      });

      md.handleAction('load', {}, { name: 'Foo' }, {}).then(function(payload) {
        assert(false);
      }, function(err) {
        assert(util.isError(err));
        done();
      });
    });


    it('should include request in context of promise', function(done) {
      var md = new ApiMiddleware();

      md.setHandler('load', 'Foo', function(payload) {
        var c = this.getContext();
        assert(c);
        assert(c.request);
        assert(c.request.iAmARequest);
        assert(c.action === 'load');
        assert(c.resource);
        assert(c.resource.name === 'Foo');
        return payload;
      });

      md.handleAction('load', {iAmARequest: true}, { name: 'Foo' }, { data: 123 }).then(function(payload) {
        assert(this.getContext());
        assert(this.getContext().request);
        assert(this.getContext().request.iAmARequest);
        done();
      }, done);
    });
  });


  describe('handlers', function() {

    var articleDoc;
    var handlerCalls = {};
    var preHandlerCalls = {};
    var postHandlerCalls = {};

    before(function(done) {
      startServer({}, function(err, server) {
        var api = server.plugins['cores-hapi'];

        function createHandler(calls, name) {
          return function(payload) {
            calls[name] = true;
            return Q.resolve(payload);
          };
        };
        api.setHandler('load', 'Article', createHandler(handlerCalls, 'load'));
        api.setHandler('create', 'Article', createHandler(handlerCalls, 'create'));
        api.setHandler('update', 'Article', createHandler(handlerCalls, 'update'));
        api.setHandler('destroy', 'Article', createHandler(handlerCalls, 'destroy'));
        api.setHandler('views', 'Article', createHandler(handlerCalls, 'views'));

        api.setPreHandler('load', createHandler(preHandlerCalls, 'load'));
        api.setPreHandler('create', createHandler(preHandlerCalls, 'create'));
        api.setPreHandler('update', createHandler(preHandlerCalls, 'update'));
        api.setPreHandler('destroy', createHandler(preHandlerCalls, 'destroy'));
        api.setPreHandler('views', createHandler(preHandlerCalls, 'views'));

        api.setPostHandler('load', createHandler(postHandlerCalls, 'load'));
        api.setPostHandler('create', createHandler(postHandlerCalls, 'create'));
        api.setPostHandler('update', createHandler(postHandlerCalls, 'update'));
        api.setPostHandler('destroy', createHandler(postHandlerCalls, 'destroy'));
        api.setPostHandler('views', createHandler(postHandlerCalls, 'views'));

        done();
      });
    });

    after(stopServer);


    it('should call the create handler on POST', function(done) {
      var doc = clone(articleData);
      server.inject(
        { method: 'POST', url: '/articles', payload: JSON.stringify(doc) },
        function(res) {
          assert(res.statusCode === 200);
          assert(handlerCalls.create);
          assert(preHandlerCalls.create);
          assert(postHandlerCalls.create);

          handlerCalls.create = false;
          preHandlerCalls.create = false;
          postHandlerCalls.create = false;

          articleDoc = res.result;

          done();
        }
      );
    });


    it('should call the create handler on PUT/id', function(done) {
      var doc = clone(articleData);
      server.inject(
        { method: 'PUT', url: '/articles/handler_test', payload: JSON.stringify(doc) },
        function(res) {
          assert(res.statusCode === 200);
          assert(handlerCalls.create);
          assert(preHandlerCalls.create);
          assert(postHandlerCalls.create);

          done();
        }
      );
    });


    it('should call the update handler on PUT/id/rev', function(done) {
      server.inject(
        { method: 'PUT', url: '/articles/' + articleDoc._id + '/' + articleDoc._rev, payload: JSON.stringify(articleDoc) },
        function(res) {
          assert(res.statusCode === 200);
          assert(handlerCalls.update);
          assert(preHandlerCalls.update);
          assert(postHandlerCalls.update);

          articleDoc = res.result;

          done();
        }
      );
    });


    it('should call the load handler on GET/id', function(done) {
      server.inject(
        { method: 'GET', url: '/articles/' + articleDoc._id },
        function(res) {
          assert(res.statusCode === 200);
          assert(handlerCalls.load);
          assert(preHandlerCalls.load);
          assert(postHandlerCalls.load);
          done();
        }
      );
    });


    it('should call the view handler on GET/view', function(done) {
      server.inject(
        { method: 'GET', url: '/articles/_views/titles' },
        function(res) {
          assert(res.statusCode === 200);
          assert(handlerCalls.views);
          assert(preHandlerCalls.views);
          assert(postHandlerCalls.views);
          done();
        }
      );
    });


    it('should call the destroy handler on DELETE/id/rev', function(done) {
      server.inject(
        { method: 'DELETE', url: '/articles/' + articleDoc._id + '/' + articleDoc._rev },
        function(res) {
          assert(res.statusCode === 200);
          assert(handlerCalls.destroy);
          assert(preHandlerCalls.destroy);
          assert(postHandlerCalls.destroy);
          done();
        }
      );
    });
  });


  describe('api with auth', function() {

    before(function(done) {
      startServer({ auth: true }, done);
    });

    after(stopServer);

    var routes = [
      { name: 'GET/index', method: 'get', url: 'http://localhost:3333/_index' },

      { name: 'GET', method: 'get', url: 'http://localhost:3333/articles' },
      { name: 'GET/id', method: 'get', url: 'http://localhost:3333/articles/auth_article' },
      { name: 'GET/_schema', method: 'get', url: 'http://localhost:3333/articles/_schema' },
      { name: 'GET/_views/*', method: 'get', url: 'http://localhost:3333/articles/_views/titles' },

      { name: 'POST', method: 'post', url: 'http://localhost:3333/articles' },
      { name: 'PUT/id', method: 'put', url: 'http://localhost:3333/articles/auth_article' },
      { name: 'PUT/id/rev', method: 'put', url: 'http://localhost:3333/articles/auth_article/123' },

      { name: 'DELETE/id/rev', method: 'del', url: 'http://localhost:3333/articles/auth_article/123' },

      { name: 'GET/_index', method: 'get', url: 'http://localhost:3333/_index' },
      { name: 'GET/_uuids', method: 'get', url: 'http://localhost:3333/_uuids' }
    ];

    routes.forEach(function(route) {
      it('should not ' + route.name, function(done) {
        var r = request[route.method](route.url, function(err, res) {
          assert(!err);
          assert(res.statusCode === 401);
          done();
        });
      });
    });
  });


  describe('api with basePath', function() {

    before(function(done) {
      startServer({ basePath: '/foo' }, done);
    });

    after(stopServer);

    it('should get index', function(done) {
      var r = request.get('http://localhost:3333/foo/_index', function(err, res) {
        assert(!err);
        assert(res.statusCode === 200);
        done();
      });
    });
  });
});
