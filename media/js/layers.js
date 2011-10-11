$(function() {

    function push(content, cls, cont) {
        var d = $(document);
        cls = cls || '';

        content = $('<div></div>').html(content)
            .addClass('layer-content ' + cls)
            .css({top: window.scrollY + 100})
            .appendTo('body');

        var layer = $('<div></div>').width(d.width())
            .height(d.height())
            .addClass('layer')
            .click(function(e) {
                e.stopPropagation();
                $(this).remove();
                $('.layer-content:last').remove();
                cont && cont();
            })
            .insertBefore('.layer-content:last');

        layer[0].pop = function() {
            cont && cont();
        }
    }

    function pop() {
        var layer = $('.layer:last');
        layer[0].pop();

        $('.layer-content:last').add(layer).remove();
    }

    function topmost() {
        return $('.layer-content:last');
    }

    function adjust() {
        var d = $(document);
        $('.layer:last').width(d.width())
            .height(d.height());
    }

    window.Layers = {
        push: push,
        pop: pop,
        topmost: topmost,
        adjust: adjust
    }
})