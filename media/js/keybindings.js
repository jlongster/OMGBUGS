$(function() {
    
    var keys = {
        's': app.show_searches,
        'j': app.next_bug,
        'k': app.prev_bug,
        'r': function() {
            if(app.current_bug) {
                app.reply();
            }
            else {
                app.refresh_search();
            }
        },
        'c': app.comment_top,
        'e': app.edit_bug,
        'esc': Layers.pop,
    }

    var doc = $(document);

    for(var key in keys) {
        doc.bind('keyup', key, keys[key]);
    }
});