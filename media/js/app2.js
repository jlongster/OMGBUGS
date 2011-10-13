$(function() {

    var Bug = Backbone.Model;
    var Comment = Backbone.Model;

    var BugList = Backbone.Collection.extend({
        model: Bug
    });

    var CommentView = Backbone.View.extend({
        tagName: 'li',

        initialize: function() {
            _.bindAll(this, 'render');

            if(!this.options.parent) {
                throw "CommentView requires a DOM element as the 'parent' parameter";
            }

            $(this.el).html($('.comment-template').html());
            $(this.options.parent).append(this.el);
        },

        render: function() {
            var el = $(this.el);
            var _this = this;

            var directives = {
                '.text': function(ctx) {
                    return _this.commentify(ctx.context.text);
                },
                '.author': 'author',
                '.date': format_date_func('time')
            }

            $(this.el).directives(directives)
                .render(this.model.attributes)

            return this;
        },

        commentify: function(str) {
            return str.replace(/\n/g, '<br />');
        }
    });

    var BugRowView = Backbone.View.extend({
        tagName: 'tr',

        events: {
            'click': 'show_bug'
        },

        initialize: function() {
            _.bindAll(this, 'render');

            this.model.bind('change', this.render);
        },

        render: function() {
            var _this = this;

            $(this.el)
                .addClass('' + this.model.get('id'))
                .html(
                _.reduce(this.options.columns, 
                         function(acc, col) {
                             var val = _this.model.get(col);

                             if(col == 'creation_time' || col == 'last_change_time') {
                                 val = format_date(new Date(Date.parse(val)));
                             }

                             return acc + '<td>' + val + '</td>'
                         },
                         '')
            );
            
            this.el.bug_id = this.model.get('id');
            return this;
        },

        show_bug: function() {
            var bug = this.model;
            var tmpl = $('.bug-template').html();

            var data = _.clone(bug.attributes);
            var directives = {};

            _.each(['id', 'summary', 'status', 'assigned_to',
                    'product','component', 'priority',
                    'target_milestone', 'url', 'creation_time',
                    'creator', 'whiteboard', 'keywords'],
                   function(field) {
                       directives['.' + field] = field;
                   });

            directives = _.extend(directives, {
                'ul.cc li': {
                    'person<-cc': { '.': 'person' }
                },
                'a.url@href': 'url',
                'a.id@href': function(ctx) {
                    return 'https://bugzilla.mozilla.org/show_bug.cgi?id=' + ctx.context.id;
                },
                'form input[name="id"]@value': 'id',
                '.creation_time': format_date_func('creation_time')
            });

            Layers.push(tmpl, 'bug', function() {
                app.current_bug = null;
            });

            $('.bug')
                .directives(directives)
                .render(data);

            $('.bug ul.comments').empty();

            Layers.adjust();

            socket.emit('get-comments', bug.get('id'));
            socket.emit('index-comments', bug.get('id'));

            app.current_bug = bug;
        }
    });
    
    var BugTableView = Backbone.View.extend({
        tagName: 'table',
        className: 'tablesorter',

        initialize: function() {
            _.bindAll(this, 'set_columns', 'get_columns', 'render',
                      'add_row', 'remove_row', 'finalize');
            var _this = this;

            if(!this.options.columns) {
                this.options.columns = ['summary'];
            }

            var headers = {}, idx;
            _.each(['creation_time', 'last_change_time'], function(name) {
                if((idx = _.indexOf(_this.options.columns, name)) != -1) {
                    headers[idx] = { sorter: 'jwl-date' };
                }
            });

            $(this.el).html(
                '<thead><tr>' +
                _.reduce(this.options.columns,
                         function(acc, col) {
                             return acc +
                                 '<th>' + col + '</th>';
                         }, '') +
                '</tr></thead>' +
                '<tbody></tbody>')
                .tablesorter({
                    headers: headers
                })
                .tablesorterFilter({filterContainer: '#filter-box',
                                    filterWaitTime: 130})
                .bind('sortEnd', function() {
                    _this.save_sort(this);
                });

            if(!this.collection) {
                this.collection = new BugList();
            }

            this.collection.bind('add', this.add_row);
            this.collection.bind('remove', this.remove_row);
            this.collection.bind('reset', this.render);

            $('.bugs').append(this.el);
            
            this.render();
        },

        render: function() {
            var _this = this;
            var el = $(this.el);

            $('tbody', el).empty();

            _.each(this.collection.models, function(model) {
                _this.add_row(model);
            });

            this.finalize();
        },
        
        add_row: function(model) {
            var el = $(this.el);
            var view = 

            $('tbody', this.el).append(
                new BugRowView({model: model,
                                columns: this.options.columns}).render().el
            );
        },

        remove_row: function(model) {
            var id = model.get('id');

            $('tbody tr', this.el).each(function() {
                if(this.bug_id == id) {
                    $(this).remove();
                }
            });
        },

        finalize: function() {
            var el = $(this.el);

            el.trigger('update');
            el.trigger('setCache');

            if(settings.sorts[app.current_search]) {
                this.sort(settings.sorts[app.current_search]);
            }
        },

        _table_sorts: function(sort) {
            return _.map(sort, function(s) {
                return [_.indexOf(settings.columns, s.field), s.order];
            });
        },

        sort: function(sorts) {
            var _this = this;

            sorts = this._table_sorts(sorts);

            // There's a race condition if the update and sorton
            // signals are called at the same time, so this is a quick
            // hack to get it working (ugh!)
            setTimeout(function() {
                $(_this.el).trigger('sorton', [sorts]);
            }, 200);
        },

        save_sort: function(table) {
            table = $(table);

            var sorts = _.map(table[0].config.sortList, function(s) {
                var idx = s[0];
                var order = s[1];
                var field = table.find('thead tr th:nth-child(' + (idx+1) + ')').text();

                return {
                    field: field,
                    order: order
                };
            });

            settings.sorts[app.current_search] = sorts;
            socket.emit('settings', settings);
        },

        set_columns: function(cols) {
            this.options.columns = cols;
            this.render();
        },
        
        get_columns: function() {
            return this.options.columns;
        },

        destroy: function() {
            $('#filter-box').unbind('keyup');
            bug_table.remove();
        }
    });

    function show_bug(id) {
        var bug = app.bug_table.collection.get(id);
        var view = new BugRowView({model: bug});
        view.show_bug();
    }

    function move_bug(dir) {
        var ids = [];
        $('table.tablesorter').find('tbody tr').each(function() {
            ids.push(this.bug_id);
        });

        var idx = _.indexOf(ids, app.current_bug.get('id'));
        var target_idx = idx+dir;

        if(idx != -1 && 
           target_idx < ids.length && 
           target_idx >= 0) {
            Layers.pop();
            show_bug(ids[target_idx]);
        }
    }

    function prev_bug() {
        move_bug(-1);
    }

    function next_bug() {
        move_bug(1);
    }

    function edit_bug() {
        var bug = app.current_bug;
        var tmpl = $('.edit-template').html();
        var data = _.clone(bug.attributes);
        data['statuses'] = ['UNCONFIRMED', 'NEW', 'ASSIGNED', 'REOPENED', 'RESOLVED'];

        var directives = {
            '.id': 'id',
            'input[name=whiteboard]@value': 'whiteboard',
            'select[name=status] option': {
                'status<-statuses': {
                    '.': 'status',
                    '.@value': 'status',
                    '.@selected': function(ctx) {
                        return ctx.item == ctx.context.status ? true : '';
                    }
                }
            }
        }

        Layers.push(tmpl, 'edit-bug');
        
        $('.edit-bug')
            .directives(directives)
            .render(data);        
    }

    function comment_top() {
        if(app.current_bug) {
            var container = $('.bug');
            window.scrollTo(0, container.offset().top - 50);
        }
    }

    function reply() {
        if(app.current_bug) {
            var container = $('.bug .comment-post');
            window.scrollTo(0, container.offset().top - 300);
            
            container.find('textarea').focus();
        }
    }

    function refresh_search() {
        if(!app.current_bug) {
            search(app.current_search, true);
            socket.emit('searches');
        }
    }

    function add_pending_comment(content) {
        var comment = new Comment({author: 'Pending...',
                                   time: new Date(),
                                   text: content});

        new CommentView({parent: $('ul.comments'),
                         model: comment,
                         className: 'pending'}).render();
    }

    function format_date_func(attr) {
        return function(ctx) {
            var d = ctx.context[attr];

            if(typeof d == 'string') {
                d = new Date(Date.parse(d));
            }
            
            return format_date(d);
        };
    }

    function format_date(d) {
        function f(v) {
            if(v < 10) {
                return '0' + v;
            }
            else {
                return v;
            }
        }

        return (d.getFullYear() + '-' + f(d.getMonth()+1) + '-' +
                f(d.getDate()) + ' ' + f(d.getHours()) + ':' +
                f(d.getMinutes()));
    }

    $.tablesorter.addParser({
        id: 'jwl-date',
        is: function(v) {
            return false;
        },
        format: function(v) {
            v = v.replace(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/, "$1/$2/$3");
            return new Date(v).getTime();
        },
        type: 'numeric'
    });

    function search(term, no_recreate) {
        app.current_search = term;
        
        if(!no_recreate) {
            if(bug_table) {
                bug_table.collection = null;
            }

            make_table();
        }

        socket.emit('search', {term: term});
        socket.emit('index-search', {term: term});
    }
    
    function set_default_search() {
        settings.default_search = app.current_search;
        socket.emit('settings', settings);
    }

    function set_columns(columns) {
        settings.columns = columns;
        app.socket.emit('settings', settings);

        make_table();
    }

    function make_table() {
        var opts = {columns: settings.columns};

        if(bug_table) {
            opts.collection = bug_table.collection;
            bug_table.destroy();
        }

        app.bug_table = bug_table = new BugTableView(opts);
    }

    var builtin_searches = ['Assigned to You', 'Reported by You'];

    var bug_table;
    var settings = {columns: ['summary', 'assigned_to'],
                    sorts:[{field: 'summary', order: 1}]};
    var socket = io.connect();

    socket.on('settings', function(opts) {
        if(opts) {
            app.settings = settings = _.extend(settings, opts);
        }

        if(settings.default_search) {
            search(settings.default_search);
        }
        else {
            make_table();
        }
    });

    socket.on('bugs', function(msg) {
        if(msg.search == app.current_search) {
            $('.searchbar').text(app.current_search);
            $('.actionbar').show();

            var model, collection = bug_table.collection;
            var ids = _.map(msg.bugs, function(bug) { return bug.id; });
            var added = [];

            _.each(msg.bugs, function(bug) {
                if((model = collection.get(bug.id))) {
                    model.set(bug);
                }
                else {
                    collection.add(new Bug(bug));
                    added.push(bug.id);
                }
            });

            var model_ids = _.map(collection.models, 
                                  function(model) { 
                                      return model.get('id');
                                  });

            var removed = _.difference(model_ids, ids);
            _.each(removed, function(id) {
                collection.remove(collection.get(id));
            });

            bug_table.finalize();

            if(added.length < ids.length) {
                var cls = _.map(added, function(id) { return '.' + id; }).join(',');
                var els = $(cls);

                // Highlight the row with a slow fade from red to
                // white, then remove the background color to allow
                // for the default css to still apply (striping,
                // hovering, etc)
                els.find('td')
                    .css({'background-color': '#aa3333'})
                    .animate({'background-color': '#ffffff'},
                             10000,
                             function() {
                                 this.style.backgroundColor = '';
                             });            
            }

            if(app.current_bug) {
                Layers.pop();
                show_bug(app.current_bug.get('id'));
            }
        }
    });

    socket.on('searches', function(searches) {
        app.searches = searches;
    });

    socket.on('comments', function(comments) {
        var container = $('.bug ul.comments');
        container.empty();

        _.each(comments, function(comment) {
            if(comment.text.length) {
                new CommentView({parent: container,
                                 model: new Comment(comment)}).render()
            }
        });

        Layers.adjust();
    });

    window.app = {
        set_default_search: set_default_search,
        set_columns: set_columns,
        bug_table: null,
        settings: {},
        builtin_searches: builtin_searches,
        search: search,
        socket: socket,
        add_pending_comment: add_pending_comment,
        prev_bug: prev_bug,
        next_bug: next_bug,
        edit_bug: edit_bug,
        reply: reply,
        refresh_search: refresh_search,
        comment_top: comment_top
    }
});