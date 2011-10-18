(function() {

    var Bug = Backbone.Model;
    var Comment = Backbone.Model;

    var BugList = Backbone.Collection.extend({
        model: Bug
    });

    window.models = {
        Bug: Bug,
        Comment: Comment,
        BugList: BugList
    };
})();
