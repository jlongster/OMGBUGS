(function() {

    // these are addons. they are hacked on, but it works pretty well.
    // basically they can take all of the bugs on a page and render
    // interesting data about them.

    function register_graph(name) {
        if(!$('#graph-' + name).length) {
            $('<div id="graph-' + name + '"></div>')
                .width(325)
                .height(325)
                .css({'float': 'left',
                      'margin': '1em'})
                .appendTo('body');
        }
    }

    function graph_assignees() {
        register_graph('assignees');

        var info = {};

        _.each(app.bug_table.collection.models, function(bug, i) { 
            var a = bug.get('assigned_to');
            info[a] = info[a] || 0;
            info[a]++;
        });

        new Highcharts.Chart({
            chart: {
                renderTo: 'graph-assignees',
                type: 'pie',
            },
            title: {
                text: 'Assignees'
            },
            tooltip: {
                formatter: function() {
                    return '<b>' + this.point.name + '</b>:<br /> ' +
                        this.y + ' bug(s)';
                }
            },
            series:[{
                data: _.map(info, function(val, key) {
                    return [key, val];
                }),
            }],
        });
    }

    function graph_my_open() {
        register_graph('my-open');

        var resolved = 0;
        var open = 0;

        _.each(app.bug_table.collection.models, function(bug, i) { 
            if(bug.get('assigned_to') == 'jlong@mozilla.com') {
                if(bug.get('status') == 'RESOLVED') {
                    resolved++;
                }
                else {
                    open++;
                }
            }
        });

        new Highcharts.Chart({
            chart: {
                renderTo: 'graph-my-open',
                type: 'pie'
            },
            title: {
                text: 'Your open bugs'
            },
            series:[{
                data: [['open', open], ['resolved', resolved]]
            }]
        });

    }

    function graph_qa() {
        register_graph('qa');

        var needs = 0;
        var ok = 0;

        _.each(app.bug_table.collection.models, function(bug, i) { 
            if(bug.get('status') == 'RESOLVED') {
                if(bug.get('whiteboard').indexOf('qawanted') != -1) {
                    needs++;
                }
                else {
                    ok++;
                }
            }
        });

        new Highcharts.Chart({
            chart: {
                renderTo: 'graph-qa',
                type: 'pie'
            },
            title: {
                text: "QA'ed"
            },
            series:[{
                data: [['is-ok', ok], ['needs-qa', needs]]
            }]
        });
    }

    _.each([graph_qa, graph_my_open, graph_assignees], function(addon) {
        register('set-bugs', addon);
        register('update-bugs', addon);
    });

    // basic event system
    var handlers;

    function register(signal, handler) {
        handlers = handlers || {};
        handlers[signal] = handlers[signal] || [];

        handlers[signal].push(handler);
    }

    function emit(signal) {
        _.each(handlers[signal] || [], function(handler) {
            handler();
        });
    }

    window.addons = {
        emit: emit
    }
})();