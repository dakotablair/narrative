/**
 * @public
 */
'use strict';

define (
    [
        'kbwidget',
        'bootstrap',
        'jquery',
        'narrativeConfig',
        'kbaseAuthenticatedWidget',
        'jquery-dataTables',
        'datatables.net-buttons',
        'datatables.net-buttons-bs',
        'datatables.net-buttons-html5',
        'knhx',
        'widgetMaxWidthCorrection'
    ], function(
        KBWidget,
        bootstrap,
        $,
        Config,
        kbaseAuthenticatedWidget
    ) {
    return KBWidget({
        name: 'kbaseConditionSet',
        parent : kbaseAuthenticatedWidget,
        version: '0.0.1',
        options: {
            obj_ref: null,
            wsURL: Config.url('workspace'),
            loadingImage: Config.get('loading_gif')
        },

        init: function(options) {
            this._super(options);

            this.options.obj_ref = this.options.upas.obj_ref;

            this.$messagePane = $("<div/>").addClass("kbwidget-message-pane kbwidget-hide-message");
            this.$elem.append(this.$messagePane);

            this.$mainPanel = $("<div>").addClass("").hide();
            this.$elem.append(this.$mainPanel);

            if (!this.options.obj_ref) {
                this.renderError("No ConditionSet to render!");
            } else if (!this.options.kbCache && !this.authToken()) {
                this.renderError("No cache given, and not logged in!");
            } else {
                this.token = this.authToken();
                this.render();
            }

            return this;
        },

        render: function() {
            this.ws = new Workspace(this.options.wsURL, {token: this.token});
            this.loading(false);
            this.$mainPanel.hide();
            this.$mainPanel.empty();
            this.loadConditionSet();
        },

        conditions: {},
        factors: {},

        loadConditionSet: function() {
            var self = this;
            self.ws.get_objects2({objects: [{ref: self.options.obj_ref}]},
                function(ret) {
                    console.log(ret);
                    var cs = ret.data[0].data;
                    var rows = [];
                    var cols = [{title: "Sample ID"}, {title: "Subset Label"}];
                    cs.factors.forEach(function(factor){
                        cols.push({title: factor.factor});
                    });
                    for (var _id in cs.conditions) {
                        if (cs.conditions.hasOwnProperty(_id)) {
                            rows.push([_id, ""].concat(cs.conditions[_id]))
                        }
                    }
                    self.renderConditionTable(rows, cols);
                    self.loading(true);
                    self.$mainPanel.show();
                },
                function(error) {
                    self.loading(true);
                    self.renderError(error);

                });
        },
        conditionTableData: [], // list for datatables

        $conditionTableDiv : null,
        renderConditionTable: function(rows, cols) {
            var self = this;

            if(!self.$conditionTableDiv) {
                self.$conditionTableDiv = $('<div>').css({'margin':'5px'});
                self.$mainPanel.append(self.$conditionTableDiv);
            }

            self.$conditionTableDiv.empty();

            var $tbl = $('<table cellpadding="0" cellspacing="0" border="0" style="width: 100%; margin-left: 0px; margin-right: 0px;">')
                            .addClass("table table-bordered table-striped");
            self.$conditionTableDiv.append($tbl);

            var sDom = "Bft<ip>";
            if(self.conditionTableData.length<=10) sDom = "Bft<i>";

            var tblSettings = {
                scrollX: true,
                scrollY: "300px",
                scrollCollapse: true,
                paging: false,
                dom: sDom,
                buttons: ['copy', 'csv'], //, 'excel', 'pdf'],
                order: [[0, "asc"]],
                columns: cols,
                data: rows
                };
            var ConditionsTable = $tbl.DataTable(tblSettings);
        },

        renderError: function(error) {
            var errString = "Sorry, an unknown error occurred";
            if (typeof error === "string")
                errString = error;
            else if (error.error && error.error.message)
                errString = error.error.message;

            var $errorDiv = $("<div>")
                            .addClass("alert alert-danger")
                            .append("<b>Error:</b>")
                            .append("<br>" + errString);
            this.$elem.empty();
            this.$elem.append($errorDiv);
        },

        loading: function(doneLoading) {
            if (doneLoading)
                this.hideMessage();
            else
                this.showMessage("<img src='" + this.options.loadingImage + "'/>");
        },

        showMessage: function(message) {
            var span = $("<span/>").append(message);

            this.$messagePane.append(span);
            this.$messagePane.show();
        },

        hideMessage: function() {
            this.$messagePane.hide();
            this.$messagePane.empty();
        },

        loggedInCallback: function(event, auth) {
            if (this.token == null) {
                this.token = auth.token;
                this.render();
            }
            return this;
        },

        loggedOutCallback: function(event, auth) {
            this.render();
            return this;
        }

    });
});
