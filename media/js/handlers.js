
$(function() {

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
    app.show_searches = show_searches;

    $('nav a.file-bug').click(function(e) {
        e.preventDefault();
        var tmpl = $('.file-bug-template').html();
        
        Layers.push(tmpl, 'file-bug');
    });

    $('nav a.about').click(function(e) {
        e.preventDefault();
        var tmpl = $('.about-template').html();

        Layers.push(tmpl, 'about');
    });

    $('nav a.settings').click(function(e) {
        e.preventDefault();
        var tmpl = $('.settings-template').html();

        Layers.push(tmpl, 'settings');
    });
    
    $('.actions .columns').click(function(e) {
        e.preventDefault();

        var bug = app.bug_table.collection.at(0);

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
            '<textarea>' + app.bug_table.get_columns().join('\n') + '</textarea>' +
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
        app.show_searches();
    });

    $('#filter-clear').click(function() {
        $('table').trigger('clearFilter');
    });

    $('.bug .comment-post input[type=submit]').live('click', function(e) {
        e.preventDefault();
        var form = $(e.target).parents('form:first');
        var ta = form.find('textarea');

        var id = form.find('input[name=id]').val();
        var content = ta.val();

        $.post('/comment/', {id: id, content: content})
            .success(function() {
                app.add_pending_comment(content);
                ta.val('');
                app.socket.emit('index-comments', id);
            })
            .error(function() { 
                console.log('comment posting error'); 
            });
    });

    $('.bug a.edit').live('click', function(e) {
        e.preventDefault();
        app.edit_bug();
    });

    $('.edit-bug input[type=submit]').live('click', function(e) {
        e.preventDefault();
        var form = $(e.target).parents('form:first');

        function get_field(name) {
            return form.find('[name=' + name + ']').val();
        }

        var id = app.current_bug.get('id');
        var data = {
            id: id,
            whiteboard: get_field('whiteboard'),
            status: get_field('status')
        }

        $.post('/edit/', data)
            .success(function() {
                Layers.pop();

                app.socket.emit('index-search', {term: app.current_search});
            })
            .error(function() {
                console.log('bug edit error');
            });                          
    });
});