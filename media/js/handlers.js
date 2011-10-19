
$(function() {

    // templates and selectors
    var templates = {};

    $(function() {
        // Load in the templates
        _.each(['comment', 'bug', 'edit',
                'file-bug', 'about', 'settings'],
               function(tmpl) {
                   var name = tmpl.replace(/-/g, '_');

                   templates[name] = $('.' + tmpl + '-template').html();
               });
    });

    var s = {
        searchbar: '.searchbar',
        actionbar: '.actionbar'
    }

    // interface functions

    function show_searches() {
        function render_searches(lst) {
            return _.reduce(lst, function(acc, s) {
                return acc + '<li><a href="#">' + s + '</a></li>';
            }, '');
        }

        Layers.push('<h2 class="title">Searches</h2>' +
                    '<ul>' +
                    render_searches(app.searches) +
                    '</ul>' +
                    '<h2 class="title">Builtin</h2>' +
                    '<ul>' +
                    render_searches(app.builtin_searches) +
                    '</ul>',
                   'searches');

        Layers.topmost()
            .find('ul a')
            .click(function(e) {
                e.preventDefault();
                var search = $(this).text();

                Layers.pop();
                app.search(search);
            });
    }

    function edit_bug() {
        var bug = app.current_bug.model;
        var tmpl = templates.edit;
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

    function move_bug(dir) {
        var ids = [];
        $(app.bug_table.el).find('tbody tr').each(function() {
            ids.push(this.bug_id);
        });

        var idx = _.indexOf(ids, app.current_bug.model.get('id'));
        var target_idx = idx+dir;

        if(idx != -1 && target_idx < ids.length && target_idx >= 0) {
            var id = ids[target_idx], view;

            view = new views.BugView(
                {model: app.bug_table.collection.get(id)}
            )
            Layers.pop();
            view.render();
        }
    }

    function prev_bug() {
        move_bug(-1);
    }

    function next_bug() {
        move_bug(1);
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

    function add_pending_comment(content) {
        var comment = new models.Comment({author: 'Pending...',
                                          time: new Date(),
                                          text: content});

        new views.CommentView({parent: $('ul.comments'),
                               model: comment,
                               className: 'pending'}).render();
    }

    function highlight_bug(id) {
        // Highlight the row with a slow fade from red to
        // white, then remove the background color to allow
        // for the default css to still apply (striping,
        // hovering, etc)
        $('.' + id).find('td')
            .css({'background-color': '#aa3333'})
            .animate({'background-color': '#ffffff'},
                     10000,
                     function() {
                         this.style.backgroundColor = '';
                     });
    }

    // interface actions

    $('nav a.file-bug').click(function(e) {
        e.preventDefault();
        Layers.push(templates.file_bug, 'file-bug');
    });

    $('nav a.about').click(function(e) {
        e.preventDefault();
        Layers.push(templates.about, 'about');
    });

    $('nav a.settings').click(function(e) {
        e.preventDefault();
        Layers.push(templates.settings, 'settings');
    });
    
    $('.actions .columns').click(function(e) {
        e.preventDefault();

        var bug = app.bug_table.collection.at(0);
	var columns = app.settings.columns || [];

        Layers.push(
            '<h2>Columns</h2>' +
            '<div>' +
            '<ul>' +
            _.keys(bug.attributes).reduce(function(acc, key) {
                if(key.substring(0, 3) != 'cf_') {
                    return acc + '<li>' + key + '</li>';
                }
                return acc;
            }, '') +
            '</ul>' +
            '<textarea>' + columns.join('\n') + '</textarea>' +
            '</div>' +
            '<input name ="save" type="submit" value="Save" />',
            'columns'
        );

        Layers.topmost()
            .find('input[name=save]')
            .click(function() {
                var field = Layers.topmost().find('textarea');
                var columns = field.val().split('\n');
                Layers.pop();

                app.set_columns(columns);
            });
    });

    $('.actions .default').click(function(e) {
        e.preventDefault();
        app.set_default_search();
    });

    $('.searchbar').click(function(e) {
        e.preventDefault();
        show_searches();
    });

    $('#filter-clear').click(function() {
        $(app.bug_table.el).trigger('clearFilter');
    });

    $('.bug .comment-post input[type=submit]').live('click', function(e) {
        e.preventDefault();
        var form = $(e.target).parents('form:first');
        var ta = form.find('textarea');

        var id = form.find('input[name=id]').val();
        var content = ta.val();

        $.post('/comment/', {id: id, content: content})
            .success(function() {
                add_pending_comment(content);
                ta.val('');
                app.update_comments(id);
            })
            .error(function() { 
                console.log('comment posting error'); 
            });
    });

    $('.bug a.edit').live('click', function(e) {
        e.preventDefault();
        edit_bug();
    });

    $('.edit-bug input[type=submit]').live('click', function(e) {
        e.preventDefault();
        var form = $(e.target).parents('form:first');

        function get_field(name) {
            return form.find('[name=' + name + ']').val();
        }

        var id = app.current_bug.model.get('id');
        var data = {
            id: id,
            whiteboard: get_field('whiteboard'),
            status: get_field('status')
        }

        $.post('/edit/', data)
            .success(function() {
                Layers.pop();
                app.update_bugs(app.current_search);
            })
            .error(function() {
                console.log('bug edit error');
            });                          
    });

    window.interface = {
        add_pending_comment: add_pending_comment,
        prev_bug: prev_bug,
        next_bug: next_bug,
        edit_bug: edit_bug,
        reply: reply,
        show_searches: show_searches,
        comment_top: comment_top,
        highlight_bug: highlight_bug,
        s: s
    };

    window.templates = templates;
});