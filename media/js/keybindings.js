$(function() {
    
    var keys = {
        's': interface.show_searches,
        'j': interface.next_bug,
        'k': interface.prev_bug,
        'r': interface.reply,
        'c': interface.comment_top,
        'e': interface.edit_bug,
        'esc': Layers.pop,
    }

    var doc = $(document);

    for(var key in keys) {
        doc.bind('keyup', key, keys[key]);
    }
});