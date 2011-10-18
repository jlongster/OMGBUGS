(function() {

    // utility

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

    // views

    var CommentView = Backbone.View.extend({
        tagName: 'li',

        initialize: function() {
            _.bindAll(this, 'render');

            if(!this.options.parent) {
                throw "CommentView requires a DOM element as the 'parent' parameter";
            }

            $(this.el).html(templates.comment);
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

    var BugView = Backbone.View.extend({
        tagName: 'div',

        initialize: function() {
            _.bindAll(this, 'on_pop');

            $(this.el).html(templates.bug);
        },
        
        render: function() {
            var bug = this.model;
            var _this = this;

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

            Layers.push(this.el, 'bug', this.on_pop);

            $('.bug')
                .directives(directives)
                .render(data);

            $('.bug ul.comments').empty();

            Layers.adjust();

            app.get_comments(bug.get('id'));
            app.current_bug = this;

            // Wait a little bit to update the comments because they
            // user might just be flipping through bugs quickly (note:
            // if comments are already indexed they will appear
            // instantly)
            this.comment_loader = setTimeout(function() {
                app.update_comments(bug.get('id'));
            }, 1000);
        },

        // run when the layer is closed
        on_pop: function() {
            app.current_bug = null;
            clearTimeout(this.comment_loader);
        },

        destroy: function() {
            Layers.pop();
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
            new BugView({model: this.model}).render();
        }

    });
    
    var BugTableView = Backbone.View.extend({
        tagName: 'table',
        className: 'tablesorter',

        initialize: function() {
            _.bindAll(this, 'render', 'make_table', 'add_row',
                      'remove_row', 'finalize');

            if(!this.options.parent) {
                throw 'BugTableView needs a DOM element as the `parent` option';
            }

            if(!this.options.columns) {
                throw 'BugTableView needs the `columns` option';
            }

            if(!this.collection) {
                this.collection = new models.BugList();
            }

            this.make_table();

            this.collection.bind('add', this.add_row);
            this.collection.bind('remove', this.remove_row);
            this.collection.bind('reset', this.render);

            $(this.options.parent).append(this.el);
            this.render();
        },

        render: function() {
            var _this = this;

            $('tbody', this.el).empty();

            if(this.collection.length) {
                _.each(this.collection.models, function(model) {
                    _this.add_row(model);
                });

                this.finalize();
            }
        },

        make_table: function() {
            var _this = this, headers = {}, idx;

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
                .tablesorterFilter({
                    filterContainer: this.options.filter_box || '#filter-box',
                    filterWaitTime: this.options.filter_waittime || 130
                })
                .bind('sortEnd', function() {
                    _this.save_sort(this);
                });
        },
        
        add_row: function(model) {
            var el = $(this.el);
            var view = new BugRowView({model: model,
                                       columns: this.options.columns});

            $('tbody', this.el).append(view.render().el);
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
            var sorts = app.settings.sorts;
            var _this = this;

            el.trigger('update');
            el.trigger('setCache');
            
            if(this.collection.length && sorts && sorts[app.current_search]) {
                _this.sort(app.settings.sorts[app.current_search]);
            }
        },

        _table_sorts: function(sort) {
            return _.map(sort, function(s) {
                return [_.indexOf(app.settings.columns, s.field), s.order];
            });
        },

        sort: function(sorts) {
            var _this = this;

            sorts = this._table_sorts(sorts);
            $(_this.el).trigger('sorton', [sorts]);
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
            
            app.set_sort(app.current_search, sorts);
        },

        destroy: function() {
            $(this.options.filter_box || '#filter-box').unbind('keyup');
            app.bug_table.remove();
        }
    });

    function make_table(keep_collection) {
        var opts = {columns: app.settings.columns || ['summary', 'assigned_to'],
                    parent: '.bugs'};

        if(app.bug_table) {
            if(keep_collection) {
                opts.collection = app.bug_table.collection;
            }

            app.bug_table.destroy();
        }

        app.bug_table = new BugTableView(opts);
    }

    window.views = {
        CommentView: CommentView,
        BugView: BugView,
        BugRowView: BugRowView,
        BugTableView: BugTableView,
        make_table: make_table
    };
})();